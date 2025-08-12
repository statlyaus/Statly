type CompletionBannerProps = {
  isComplete: boolean;
  onReset?: () => void;
};

export default function CompletionBanner({ isComplete, onReset }: CompletionBannerProps) {
  if (!isComplete) return null;
  
  return (
    <div className="bg-green-500 text-white p-4 text-center rounded-lg my-4">
      <h2 className="text-lg font-semibold">Congratulations! You&apos;ve completed your team.</h2>
      {onReset && (
        <button
          onClick={onReset}
          className="mt-3 px-4 py-2 rounded bg-white text-green-500 hover:bg-gray-100 transition-colors"
        >
          Reset Team
        </button>
      )}
    </div>
  );
}
