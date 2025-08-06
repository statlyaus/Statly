

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <div className="space-y-6">
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl">
          Welcome to Statly
        </h1>
        <p className="text-lg leading-8 text-gray-300">
          Your Fantasy AFL Platform.
        </p>
        <div className="mt-10 flex items-center justify-center gap-x-6">
          <a
            href="/dashboard" // You can change this link later
            className="rounded-md bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
          >
            Get started
          </a>
        </div>
      </div>
    </main>
  );
}