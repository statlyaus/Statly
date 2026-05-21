type CompletionBannerProps = {
  isComplete: boolean;
  onReset?: () => void;
};

export default function CompletionBanner({ isComplete, onReset }: CompletionBannerProps) {
  if (!isComplete) return null;

  return (
    <div className="bg-success text-white p-4 text-center rounded-lg my-4">
      <h2 className="text-lg font-semibold">Congratulations! You&apos;ve completed your team.</h2>
      {onReset && (
        <button
          onClick={onReset}
          className="mt-3 px-4 py-2 rounded bg-white text-success hover:bg-muted transition-colors"
        >
          Reset Team
        </button>
      )}
    </div>
  );
}
