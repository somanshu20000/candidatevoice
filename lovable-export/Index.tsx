import { Link } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { SubmissionCard } from "@/components/SubmissionCard";
import { submissions } from "@/data/mockData";
import { ArrowRight, Shield, Eye, Globe } from "lucide-react";

const stats = [
  { label: "Submissions", value: "1,247" },
  { label: "Companies", value: "89" },
  { label: "Roles Tracked", value: "234" },
];

const steps = [
  { num: "01", title: "Submit anonymously", description: "Share your rejection experience without revealing your identity.", icon: Shield },
  { num: "02", title: "Moderation review", description: "Every submission is reviewed to ensure no names or proprietary info.", icon: Eye },
  { num: "03", title: "Goes public", description: "Approved submissions become searchable data for all candidates.", icon: Globe },
];

const recentSubmissions = [...submissions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6);

export default function Index() {
  return (
    <Layout>
      {/* Hero */}
      <section className="container pt-20 pb-16">
        <div className="max-w-3xl">
          <span className="inline-flex items-center rounded-sm border border-border bg-card px-3 py-1 text-xs font-mono text-muted-foreground mb-6">
            Open Source · MIT · CC0 Data
          </span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-heading font-bold tracking-tight text-foreground leading-[1.1] mb-4">
            Know the process<br />before you apply
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mb-8 leading-relaxed">
            Crowdsourced, anonymized rejection experiences from real candidates. No names. No spin. Just signal.
          </p>
          <div className="flex items-center gap-3">
            <Link
              to="/submit"
              className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Share Your Experience
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/browse"
              className="inline-flex items-center gap-2 rounded-lg border border-border text-foreground px-5 py-2.5 text-sm font-medium hover:border-primary/50 hover:text-primary transition-colors"
            >
              Browse Data
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-border">
        <div className="container py-6 flex items-center justify-start gap-12 md:gap-16">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="text-2xl md:text-3xl font-mono font-semibold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="container py-16">
        <h2 className="text-xl font-heading font-semibold text-foreground mb-8">How it works</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((step) => (
            <div key={step.num} className="border border-border rounded-lg p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="font-mono text-sm text-primary font-semibold">{step.num}</span>
                <step.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Submissions */}
      <section className="container pb-16">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-heading font-semibold text-foreground">Recent submissions</h2>
          <Link to="/browse" className="text-sm text-primary hover:underline">
            View all →
          </Link>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recentSubmissions.map((sub) => (
            <SubmissionCard key={sub.id} submission={sub} />
          ))}
        </div>
      </section>
    </Layout>
  );
}
