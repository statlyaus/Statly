export const metadata = {
  title: 'Terms of Service | Statly',
  description: 'The terms and conditions for using Statly.',
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
      <p className="text-sm text-base-content/60 mb-8">
        Last updated: {new Date().toLocaleDateString()}
      </p>

      <section className="prose prose-neutral dark:prose-invert max-w-none">
        <p>
          These Terms of Service (&quot;Terms&quot;) govern your access to and use of Statly. By
          using the service, you agree to these Terms. If you do not agree, do not use Statly.
        </p>
        <h2>Use of Service</h2>
        <p>
          You must use the service in compliance with applicable laws and these Terms. We may
          suspend or terminate access for violations or misuse.
        </p>
        <h2>Accounts</h2>
        <p>
          You are responsible for the security of your account and for all activities that occur
          under your account.
        </p>
        <h2>Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Statly is not liable for any indirect, incidental,
          or consequential damages arising from your use of the service.
        </p>
        <h2>Contact</h2>
        <p>
          For questions about these Terms, please contact us through the contact details on our
          website.
        </p>
      </section>
    </main>
  );
}
