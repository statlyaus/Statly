export const metadata = {
  title: 'Data Deletion | Statly',
  description: 'How to delete your Statly account and personal data.',
  robots: { index: true, follow: true },
};

export default function DataDeletionPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-6">Data Deletion</h1>
      <p className="text-sm text-base-content/60 mb-8">Last updated: {new Date().toLocaleDateString()}</p>

      <section className="prose prose-neutral dark:prose-invert max-w-none">
        <p>
          You can request deletion of your account and associated personal data at any time. Once your
          request is processed, your account will be permanently removed and cannot be restored.
        </p>

        <h2>How to request deletion</h2>
        <ol>
          <li>
            Send an email to <a href="mailto:robaddisonlbm@gmail.com">robaddisonlbm@gmail.com</a> from the email
            address associated with your Statly account, with the subject: <em>Account Deletion Request</em>.
          </li>
          <li>
            We will verify your request and confirm deletion. You will receive a confirmation email when
            the process is complete.
          </li>
        </ol>

        <h2>What will be deleted</h2>
        <ul>
          <li>Account profile and authentication data.</li>
          <li>Personal information stored in our systems that is associated with your account.</li>
          <li>Content or usage data linked to your identity, unless we are required to retain it by law.</li>
        </ul>

        <h2>Questions</h2>
        <p>
          If you have questions about data deletion or privacy, contact us at
          <a className="ml-1" href="mailto:robaddisonlbm@gmail.com">robaddisonlbm@gmail.com</a>.
        </p>
      </section>
    </main>
  );
}
