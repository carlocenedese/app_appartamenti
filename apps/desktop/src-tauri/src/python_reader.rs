//! Runs the bundled PDF reader, `python -I -m bollette_pdf extract` (plan 23), with the contract
//! of python/bollette_pdf/__main__.py: one JSON document on stdout in UTF-8, exit code 0 for every
//! valid result. Only `std` (and `serde_json`, already a dependency): no shell, no network, the
//! arguments are a vector. The stdout text goes back as it is: the core validates it
//! (`parseExtractionResult`), so nothing is re-serialised here.

use serde_json::{Value, json};
use std::ffi::{OsStr, OsString};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

/// OCR pages are slow: the same limit as `PYTHON_TIMEOUT_MS` of scripts/estratti.mjs (R381).
pub const TIMEOUT: Duration = Duration::from_secs(60);
/// The same cap as `MAX_STDOUT_BYTES` of the core's test helper.
pub const MAX_STDOUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const POLL: Duration = Duration::from_millis(20);

/// Why a reading did not give a JSON text. Messages are Italian and never hold a path or text of
/// the document: the first line of stderr is a generic sentence of the package.
#[derive(Debug, PartialEq, Eq)]
pub enum ReadError {
    PathForbidden,
    PythonMissing,
    Timeout { seconds: u64 },
    OutputTooLarge,
    ExitCode { code: Option<i32>, first_line: String },
    InvalidJson,
    Internal,
}

impl ReadError {
    pub fn code(&self) -> &'static str {
        match self {
            ReadError::PathForbidden => "path-forbidden",
            ReadError::PythonMissing => "python-missing",
            ReadError::Timeout { .. } => "timeout",
            ReadError::OutputTooLarge => "output-too-large",
            ReadError::ExitCode { .. } => "exit-code",
            ReadError::InvalidJson => "invalid-json",
            ReadError::Internal => "internal",
        }
    }

    pub fn message(&self) -> String {
        match self {
            ReadError::PathForbidden => {
                "Il file o la cartella non sono nella cartella scelta: lettura non avviata.".into()
            }
            ReadError::PythonMissing => {
                "Il lettore dei PDF non è disponibile: interprete Python non trovato.".into()
            }
            ReadError::Timeout { seconds } => {
                format!("Lettura interrotta: nessuna risposta entro {seconds} s.")
            }
            ReadError::OutputTooLarge => "Lettura interrotta: risposta troppo grande.".into(),
            ReadError::ExitCode {
                code: Some(EXIT_ERROR),
                first_line,
            } if is_package_sentence(first_line) => first_line.clone(),
            ReadError::ExitCode { code: Some(code), .. } => {
                format!("Python è uscito con il codice {code}.")
            }
            ReadError::ExitCode { code: None, .. } => {
                "Python è stato interrotto dal sistema.".into()
            }
            ReadError::InvalidJson => "La risposta di Python non è JSON.".into(),
            ReadError::Internal => "Errore interno: lettura non completata.".into(),
        }
    }

    /// What the webview receives when the command fails: `{ code, message }`.
    pub fn to_value(&self) -> Value {
        json!({ "code": self.code(), "message": self.message() })
    }
}

/// The package's exit code for wrong arguments or an unreadable file (`EXIT_ERROR` in
/// python/bollette_pdf/__main__.py): only then is the first line of stderr one of its constant
/// sentences. Any other code may come from the interpreter itself, whose messages hold paths
/// (the Windows user name) or an English traceback.
const EXIT_ERROR: i32 = 2;

/// A sentence of the package: not empty and without a path separator, for extra safety.
fn is_package_sentence(line: &str) -> bool {
    !line.is_empty() && !line.contains(['/', '\\'])
}

/// The interpreter of the `python/` resource, as `interpreterPath` of scripts/bundle-python.mjs.
pub fn bundled_interpreter(resource_dir: &Path, windows: bool) -> PathBuf {
    let python = resource_dir.join("python");
    if windows {
        python.join("python.exe")
    } else {
        python.join("bin").join("python3")
    }
}

/// `dev_override` is `PYTHON`, which the caller reads only in debug builds: a release build
/// always runs the bundled interpreter, never the system one.
pub fn choose_interpreter(bundled: PathBuf, dev_override: Option<OsString>) -> PathBuf {
    match dev_override {
        Some(value) if !value.is_empty() => PathBuf::from(value),
        _ => bundled,
    }
}

/// The `ocr-data/` resource, only when it holds the language data (Windows ships none yet).
pub fn ocr_data(resource_dir: &Path) -> Option<PathBuf> {
    let folder = resource_dir.join("ocr-data");
    folder.join("ita.traineddata").is_file().then_some(folder)
}

fn flag(name: &str, value: &OsStr) -> OsString {
    let mut text = OsString::from(name);
    text.push(value);
    text
}

/// The arguments of `extract`. `--name=value`: a value that starts with `-` stays a value.
pub fn extract_args(
    pdf: &Path,
    profiles: &Path,
    at: &str,
    pages: Option<&str>,
    ocr_data: Option<&Path>,
) -> Vec<OsString> {
    // -B: no `.pyc` written into the signed app bundle (-I ignores PYTHONDONTWRITEBYTECODE).
    let mut args: Vec<OsString> = ["-B", "-I", "-m", "bollette_pdf", "extract"]
        .into_iter()
        .map(OsString::from)
        .collect();
    args.push(flag("--pdf=", pdf.as_os_str()));
    args.push(flag("--profiles=", profiles.as_os_str()));
    args.push(flag("--at=", OsStr::new(at)));
    if let Some(pages) = pages {
        args.push(flag("--pages=", OsStr::new(pages)));
    }
    if let Some(folder) = ocr_data {
        args.push(flag("--ocr-data=", folder.as_os_str()));
    }
    args
}

/// An absolute path that exists, of the wanted kind, and that `allowed` accepts (the file scope
/// of the plugin: the folder the user picked). Gives the canonical path, the one checked, so a
/// link changed afterwards cannot point Python elsewhere.
pub fn checked_path(
    raw: &str,
    want_dir: bool,
    allowed: &dyn Fn(&Path) -> bool,
) -> Result<PathBuf, ReadError> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err(ReadError::PathForbidden);
    }
    let real = std::fs::canonicalize(path).map_err(|_| ReadError::PathForbidden)?;
    let kind = if want_dir { real.is_dir() } else { real.is_file() };
    if !kind || !allowed(&real) {
        return Err(ReadError::PathForbidden);
    }
    Ok(without_verbatim_drive(real))
}

/// `\\?\C:\…` (what `canonicalize` gives on Windows) as `C:\…`, the form Python and the user
/// know; any other path, `\\?\UNC\…` included, as it is.
/// shortcut: drive paths only, a network share keeps the long form; upgrade if one is used.
pub fn without_verbatim_drive(path: PathBuf) -> PathBuf {
    let short = path.to_str().and_then(|text| {
        let bytes = text.as_bytes();
        let drive = bytes.len() >= 7
            && text.starts_with("\\\\?\\")
            && bytes[4].is_ascii_alphabetic()
            && bytes[5] == b':'
            && bytes[6] == b'\\';
        drive.then(|| PathBuf::from(&text[4..]))
    });
    short.unwrap_or(path)
}

/// Reads to the end (a full pipe would stall the child), keeping at most `cap` bytes; `over`
/// turns true as soon as there were more.
fn read_capped(mut source: impl Read, cap: usize, over: &AtomicBool) -> Vec<u8> {
    let mut kept = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match source.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                if over.load(Ordering::Relaxed) || kept.len() + n > cap {
                    // Keep draining, never appending: the result is OutputTooLarge anyway.
                    over.store(true, Ordering::Relaxed);
                } else {
                    kept.extend_from_slice(&buffer[..n]);
                }
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    kept
}

fn stop(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn first_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Runs `interpreter` with `args` and gives all of stdout, which must be UTF-8 JSON. The child is
/// killed (and waited for) past `timeout` or past `max_stdout` bytes of output.
pub fn run(
    interpreter: &Path,
    args: &[OsString],
    timeout: Duration,
    max_stdout: usize,
) -> Result<String, ReadError> {
    let mut command = Command::new(interpreter);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window flashes up, as `windowsHide` in the core's helper.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|_| ReadError::PythonMissing)?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        stop(&mut child);
        return Err(ReadError::Internal);
    };
    let too_large = Arc::new(AtomicBool::new(false));
    let flag_out = Arc::clone(&too_large);
    let out_thread = thread::spawn(move || read_capped(stdout, max_stdout, &flag_out));
    let err_thread = thread::spawn(move || {
        let ignored = AtomicBool::new(false);
        read_capped(stderr, MAX_STDERR_BYTES, &ignored)
    });
    let start = Instant::now();
    let status = loop {
        if too_large.load(Ordering::Relaxed) {
            stop(&mut child);
            return Err(ReadError::OutputTooLarge);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() >= timeout => {
                stop(&mut child);
                return Err(ReadError::Timeout {
                    seconds: timeout.as_secs(),
                });
            }
            Ok(None) => thread::sleep(POLL),
            Err(_) => {
                stop(&mut child);
                return Err(ReadError::Internal);
            }
        }
    };
    // The threads end at EOF: the package starts no subprocess that could keep the pipes open.
    let stdout = out_thread.join().map_err(|_| ReadError::Internal)?;
    let stderr = err_thread.join().map_err(|_| ReadError::Internal)?;
    if too_large.load(Ordering::Relaxed) {
        return Err(ReadError::OutputTooLarge);
    }
    if !status.success() {
        return Err(ReadError::ExitCode {
            code: status.code(),
            first_line: first_line(&stderr),
        });
    }
    let text = String::from_utf8(stdout).map_err(|_| ReadError::InvalidJson)?;
    serde_json::from_str::<Value>(&text).map_err(|_| ReadError::InvalidJson)?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[OsString]) -> Vec<String> {
        args.iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    /// A fresh folder in the temporary directory, unique to this process and test.
    fn temp_folder(name: &str) -> PathBuf {
        let folder =
            std::env::temp_dir().join(format!("app-bollette-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn builds_the_arguments_of_extract() {
        let args = extract_args(
            Path::new("/c/Bollette è/luce.pdf"),
            Path::new("/c/_app/dati/supplierProfile"),
            "2026-11-19",
            None,
            None,
        );
        assert_eq!(
            strings(&args),
            [
                "-B",
                "-I",
                "-m",
                "bollette_pdf",
                "extract",
                "--pdf=/c/Bollette è/luce.pdf",
                "--profiles=/c/_app/dati/supplierProfile",
                "--at=2026-11-19",
            ]
        );
        let args = extract_args(
            Path::new("/c/a.pdf"),
            Path::new("/c/p"),
            "--help",
            Some("3-4"),
            Some(Path::new("/r/ocr-data")),
        );
        assert_eq!(
            strings(&args)[7..],
            ["--at=--help", "--pages=3-4", "--ocr-data=/r/ocr-data"]
        );
    }

    #[test]
    fn runs_the_bundled_interpreter_unless_a_dev_override() {
        let resources = Path::new("/r");
        assert_eq!(
            bundled_interpreter(resources, false),
            Path::new("/r/python/bin/python3")
        );
        assert_eq!(
            bundled_interpreter(resources, true),
            Path::new("/r/python").join("python.exe")
        );
        let bundled = bundled_interpreter(resources, false);
        assert_eq!(choose_interpreter(bundled.clone(), None), bundled);
        assert_eq!(
            choose_interpreter(bundled.clone(), Some(OsString::new())),
            bundled
        );
        assert_eq!(
            choose_interpreter(bundled, Some(OsString::from("/venv/bin/python"))),
            Path::new("/venv/bin/python")
        );
    }

    #[test]
    fn passes_ocr_data_only_with_the_language_file() {
        let resources = temp_folder("ocr");
        std::fs::create_dir_all(resources.join("ocr-data")).unwrap();
        assert_eq!(ocr_data(&resources), None);
        std::fs::write(resources.join("ocr-data/ita.traineddata"), b"x").unwrap();
        assert_eq!(ocr_data(&resources), Some(resources.join("ocr-data")));
    }

    #[test]
    fn checks_paths_against_the_scope() {
        let folder = temp_folder("paths");
        let pdf = folder.join("bolletta.pdf");
        std::fs::write(&pdf, b"%PDF").unwrap();
        let yes = |_: &Path| true;
        let no = |_: &Path| false;
        let pdf_text = pdf.to_str().unwrap();
        let real = std::fs::canonicalize(&pdf).unwrap();
        assert_eq!(checked_path(pdf_text, false, &yes), Ok(real));
        assert_eq!(
            checked_path(pdf_text, false, &no),
            Err(ReadError::PathForbidden)
        );
        assert_eq!(
            checked_path(pdf_text, true, &yes),
            Err(ReadError::PathForbidden)
        );
        assert_eq!(
            checked_path("bolletta.pdf", false, &yes),
            Err(ReadError::PathForbidden)
        );
        let missing = folder.join("manca.pdf");
        assert_eq!(
            checked_path(missing.to_str().unwrap(), false, &yes),
            Err(ReadError::PathForbidden)
        );
        assert!(checked_path(folder.to_str().unwrap(), true, &yes).is_ok());
    }

    #[test]
    fn maps_errors_to_code_and_italian_message() {
        let value = ReadError::Timeout { seconds: 60 }.to_value();
        assert_eq!(value["code"], "timeout");
        assert_eq!(
            value["message"],
            "Lettura interrotta: nessuna risposta entro 60 s."
        );
        let exit = |code, line: &str| ReadError::ExitCode {
            code,
            first_line: line.into(),
        };
        assert_eq!(exit(Some(2), "Argomenti non validi.").message(), "Argomenti non validi.");
        assert_eq!(exit(Some(3), "").message(), "Python è uscito con il codice 3.");
        assert_eq!(exit(None, "").message(), "Python è stato interrotto dal sistema.");
        assert_eq!(exit(None, "").code(), "exit-code");
        for error in [
            ReadError::PathForbidden,
            ReadError::PythonMissing,
            ReadError::OutputTooLarge,
            ReadError::InvalidJson,
            ReadError::Internal,
        ] {
            assert!(!error.message().is_empty());
        }
        assert_eq!(ReadError::PythonMissing.code(), "python-missing");
    }

    #[test]
    fn forwards_stderr_only_for_the_package_exit_code() {
        let exit = |code, line: &str| ReadError::ExitCode {
            code,
            first_line: line.into(),
        };
        let interpreter =
            r"C:\Programmi\App Bollette\python\python.exe: No module named bollette_pdf";
        assert_eq!(exit(Some(1), interpreter).message(), "Python è uscito con il codice 1.");
        assert_eq!(
            exit(Some(1), "Traceback (most recent call last):").message(),
            "Python è uscito con il codice 1."
        );
        assert_eq!(exit(Some(2), interpreter).message(), "Python è uscito con il codice 2.");
        assert_eq!(
            exit(Some(2), "/opt/app/python3: errore").message(),
            "Python è uscito con il codice 2."
        );
        assert_eq!(
            exit(None, "Argomenti non validi.").message(),
            "Python è stato interrotto dal sistema."
        );
    }

    #[test]
    fn drops_the_verbatim_prefix_of_a_drive_path_only() {
        let cases = [
            (r"\\?\C:\Bollette\luce.pdf", r"C:\Bollette\luce.pdf"),
            (r"\\?\UNC\server\share\a.pdf", r"\\?\UNC\server\share\a.pdf"),
            (r"C:\Bollette\luce.pdf", r"C:\Bollette\luce.pdf"),
            ("/Users/a/luce.pdf", "/Users/a/luce.pdf"),
            (r"\\?\", r"\\?\"),
        ];
        for (given, expected) in cases {
            assert_eq!(without_verbatim_drive(PathBuf::from(given)), PathBuf::from(expected));
        }
    }

    #[test]
    fn a_missing_interpreter_is_python_missing() {
        let missing = temp_folder("missing").join("python3");
        assert_eq!(
            run(&missing, &[], TIMEOUT, MAX_STDOUT_BYTES),
            Err(ReadError::PythonMissing)
        );
    }

    // The tests below start /bin/sh as a stand-in interpreter; the app never runs a shell.
    #[cfg(unix)]
    fn sh(script: &str, timeout: Duration, max: usize) -> Result<String, ReadError> {
        let args = [OsString::from("-c"), OsString::from(script)];
        run(Path::new("/bin/sh"), &args, timeout, max)
    }

    #[cfg(unix)]
    #[test]
    fn gives_stdout_when_it_is_json() {
        let text = sh("printf '{\"v\": 1, \"nome\": \"è\"}\\n'", TIMEOUT, 1000);
        assert_eq!(text, Ok("{\"v\": 1, \"nome\": \"è\"}\n".into()));
    }

    #[cfg(unix)]
    #[test]
    fn kills_a_child_past_the_timeout() {
        let start = Instant::now();
        let result = sh("sleep 20", Duration::from_millis(300), 1000);
        assert_eq!(result, Err(ReadError::Timeout { seconds: 0 }));
        assert!(start.elapsed() < Duration::from_secs(10));
    }

    #[cfg(unix)]
    #[test]
    fn a_package_error_gives_the_first_line_of_stderr() {
        let result = sh(
            "printf 'Argomenti non validi.\\naltro\\n' >&2; exit 2",
            TIMEOUT,
            1000,
        );
        assert_eq!(
            result,
            Err(ReadError::ExitCode {
                code: Some(2),
                first_line: "Argomenti non validi.".into(),
            })
        );
        let other = sh("printf '/opt/app/python3: No module\\n' >&2; exit 1", TIMEOUT, 1000);
        assert_eq!(
            other.unwrap_err().message(),
            "Python è uscito con il codice 1."
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_text_that_is_not_json_or_not_utf8() {
        assert_eq!(sh("printf 'non json'", TIMEOUT, 1000), Err(ReadError::InvalidJson));
        assert_eq!(sh("printf '\\377'", TIMEOUT, 1000), Err(ReadError::InvalidJson));
    }

    #[cfg(unix)]
    #[test]
    fn stops_an_output_too_large() {
        let result = sh("while :; do printf '0123456789'; done", TIMEOUT, 1000);
        assert_eq!(result, Err(ReadError::OutputTooLarge));
    }
}
