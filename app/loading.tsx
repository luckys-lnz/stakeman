export default function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-bar" />
      <span>Loading the latest numbers…</span>
    </div>
  );
}
