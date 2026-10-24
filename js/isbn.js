// ISBN の正規化と検証。日本の本の下段バーコード（192 で始まる価格コード）は ISBN として扱わない。

export function normalize(raw) {
  return String(raw || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValid13(code) {
  if (!/^97[89]\d{10}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

export function isValid10(code) {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (code[i] === 'X' ? 10 : Number(code[i])) * (10 - i);
  return sum % 11 === 0;
}

export function to13(code10) {
  const body = '978' + code10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  return body + ((10 - (sum % 10)) % 10);
}

// 読み取った文字列や手入力を ISBN-13 にする。ISBN でなければ null。
export function toIsbn13(raw) {
  const code = normalize(raw);
  if (code.length === 13) return isValid13(code) ? code : null;
  if (code.length === 10) return isValid10(code) ? to13(code) : null;
  return null;
}

export function format(isbn13) {
  return isbn13 ? `${isbn13.slice(0, 3)}-${isbn13.slice(3)}` : '';
}
