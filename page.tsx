import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="mt-4">Welcome to your Statly dashboard.</p>
      <div className="mt-8">
        <Link href="/stats" className="btn btn-primary">View Player Stats</Link>
      </div>
    </div>
  );
}