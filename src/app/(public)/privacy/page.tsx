export const metadata = {
  title: 'Privacy Policy | Statly',
  description: 'How Statly collects, uses, and protects your information.',
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10">
      <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
      <p className="text-sm text-base-content/60 mb-8">
        Last updated: {new Date().toLocaleDateString()}
      </p>

      <section className="prose prose-neutral dark:prose-invert max-w-none">
        <p>
          Statly (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is committed to protecting
          your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard
          your information when you use our website and services.
        </p>

        <h2>Information We Collect</h2>
        <ul>
          <li>
            Account information (e.g., name, email) provided during sign up or via social login
            providers.
          </li>
          <li>
            Authentication data provided by third-party identity providers (e.g., Google, Facebook,
            Apple).
          </li>
          <li>
            Technical and usage data (e.g., device, browser, pages visited) to improve our services.
          </li>
        </ul>

        <h2>How We Use Your Information</h2>
        <ul>
          <li>To provide, operate, and maintain the Statly service.</li>
          <li>To authenticate users and secure accounts.</li>
          <li>To personalize content and improve user experience.</li>
          <li>To communicate important updates and respond to inquiries.</li>
        </ul>

        <h2>Third-Party Services</h2>
        <p>
          We use third-party services, including Firebase Authentication, to manage user accounts
          and authentication. These services may process your information in accordance with their
          own privacy policies.
        </p>

        <h2>Data Retention</h2>
        <p>
          We retain your information for as long as your account is active or as needed to provide
          services and comply with legal obligations.
        </p>

        <h2>Your Rights</h2>
        <p>
          Depending on your location, you may have rights to access, correct, or delete your
          personal data. To exercise these rights, contact us using the details below.
        </p>

        <h2>Contact</h2>
        <p>
          For questions about this policy, please contact us via the contact details provided on our
          website.
        </p>
      </section>
    </main>
  );
}
