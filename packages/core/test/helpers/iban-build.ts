/** A valid Italian IBAN ending with `account` (invented numbers only): the check digits are computed. */
export function ibanEndingWith(account: string): string {
  const bban = 'X' + '05428' + '11101' + account.padStart(12, '0');
  const moved = bban + 'IT00';
  let remainder = 0;
  for (const char of moved) {
    const digits = char >= 'A' ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return `IT${String(98 - remainder).padStart(2, '0')}${bban}`;
}
