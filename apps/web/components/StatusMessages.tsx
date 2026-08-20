export function StatusMessages({
  error,
  notice,
  loading,
}: {
  error?: string | null;
  notice?: string | null;
  loading?: string | null;
}) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status" aria-live="polite">
          {notice}
        </p>
      )}
      {loading && (
        <p className="loading-status" role="status" aria-live="polite">
          {loading}
        </p>
      )}
    </>
  );
}
