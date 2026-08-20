import QRCode from "qrcode";

/** Uses the maintained QR encoder and returns its module grid for SVG rendering. */
export function createQrMatrix(text: string): boolean[][] {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_unused, column) => Boolean(data[row * size + column])),
  );
}
