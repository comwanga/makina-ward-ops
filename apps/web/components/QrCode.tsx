import { createQrMatrix } from "@/lib/qr";

export function QrCode({ value, size = 260 }: { value: string; size?: number }) {
  const matrix = createQrMatrix(value);
  const quiet = 4;
  const viewSize = matrix.length + quiet * 2;
  return (
    <svg
      className="qr-code"
      width={size}
      height={size}
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      role="img"
      aria-label="Attendance check-in QR code"
      shapeRendering="crispEdges"
    >
      <rect width={viewSize} height={viewSize} fill="#fff" />
      <path
        fill="#000"
        d={matrix
          .flatMap((row, y) =>
            row.flatMap((filled, x) => (filled ? [`M${x + quiet} ${y + quiet}h1v1h-1z`] : [])),
          )
          .join("")}
      />
    </svg>
  );
}
