import { captureException, captureMessage } from '@/lib/sentry-utils';

// Add this button component to your app to test Sentry's error tracking
function ErrorButton() {
  const handleError = () => {
    console.log('🚨 About to throw error...');

    try {
      // First, let's test if Sentry is working by sending a test message
      captureMessage('Testing Sentry before throwing error', 'info');
      console.log('✅ Test message sent to Sentry');

      // Now throw the error
      throw new Error('This is your first error!');
    } catch (error) {
      console.log('🚨 Error caught, sending to Sentry...');

      // Manually capture the error
      captureException(error);
      console.log('✅ Error manually captured and sent to Sentry');

      // Re-throw to trigger the error boundary
      throw error;
    }
  };

  return (
    <button
      onClick={handleError}
      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
    >
      Break the world
    </button>
  );
}

export default ErrorButton;
