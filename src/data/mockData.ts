export type RejectionStage = "applied" | "screened" | "interviewed" | "offered";

export interface Company {
  id: string;
  slug: string;
  name: string;
  industry: string;
  domain: string;
}

export interface Submission {
  id: string;
  company: Company;
  role_title: string;
  rejection_stage: RejectionStage;
  rejection_reason: string;
  experience_text: string;
  created_at: string;
}

export const companies: Company[] = [
  { id: "1", slug: "google", name: "Google", industry: "Big Tech", domain: "google.com" },
  { id: "2", slug: "microsoft", name: "Microsoft", industry: "Big Tech", domain: "microsoft.com" },
  { id: "3", slug: "amazon", name: "Amazon", industry: "E-commerce / Cloud", domain: "amazon.com" },
  { id: "4", slug: "flipkart", name: "Flipkart", industry: "E-commerce", domain: "flipkart.com" },
  { id: "5", slug: "razorpay", name: "Razorpay", industry: "Fintech", domain: "razorpay.com" },
  { id: "6", slug: "swiggy", name: "Swiggy", industry: "Food Tech", domain: "swiggy.com" },
  { id: "7", slug: "cred", name: "CRED", industry: "Fintech", domain: "cred.club" },
  { id: "8", slug: "infosys", name: "Infosys", industry: "IT Services", domain: "infosys.com" },
  { id: "9", slug: "meesho", name: "Meesho", industry: "E-commerce", domain: "meesho.com" },
  { id: "10", slug: "zomato", name: "Zomato", industry: "Food Tech", domain: "zomato.com" },
];

export const submissions: Submission[] = [
  {
    id: "s1",
    company: companies[0],
    role_title: "Senior Software Engineer",
    rejection_stage: "interviewed",
    rejection_reason: "Did not meet the bar on system design round.",
    experience_text: "Three rounds of interviews over two weeks. The system design round was for a distributed URL shortener. Feedback was that my design lacked detail on the caching layer. No further follow-up was offered.",
    created_at: "2026-03-15T10:00:00Z",
  },
  {
    id: "s2",
    company: companies[1],
    role_title: "Product Manager",
    rejection_stage: "screened",
    rejection_reason: "Profile did not align with team's current needs.",
    experience_text: "Applied online and received a recruiter call within a week. Asked about availability and experience, then was told the role was paused. No further communication.",
    created_at: "2026-03-10T09:30:00Z",
  },
  {
    id: "s3",
    company: companies[2],
    role_title: "SDE II",
    rejection_stage: "offered",
    rejection_reason: "Offer rescinded due to headcount freeze.",
    experience_text: "Completed the full loop — five rounds including a bar raiser. Received a verbal offer. Three weeks later, HR sent an email saying the headcount was frozen and the offer was rescinded. No compensation for time invested.",
    created_at: "2026-03-01T14:00:00Z",
  },
  {
    id: "s4",
    company: companies[3],
    role_title: "Data Scientist",
    rejection_stage: "applied",
    rejection_reason: "No response received.",
    experience_text: "Applied through the careers portal. Received an automated acknowledgement email. Heard nothing after that — not even a rejection. Profile seemed to match the JD well.",
    created_at: "2026-02-20T11:00:00Z",
  },
  {
    id: "s5",
    company: companies[4],
    role_title: "Backend Engineer",
    rejection_stage: "interviewed",
    rejection_reason: "Strong in coding, weak in product thinking.",
    experience_text: "Two technical rounds were smooth. The third round was a product case study which I was not prepared for. Feedback given post-rejection was helpful and specific.",
    created_at: "2026-03-12T08:00:00Z",
  },
  {
    id: "s6",
    company: companies[5],
    role_title: "Engineering Manager",
    rejection_stage: "screened",
    rejection_reason: "Not enough people management experience.",
    experience_text: "Phone screen lasted 20 minutes. Mostly focused on how many direct reports I had managed. My answer of three was apparently below their threshold of five.",
    created_at: "2026-03-08T15:00:00Z",
  },
  {
    id: "s7",
    company: companies[6],
    role_title: "Frontend Engineer",
    rejection_stage: "interviewed",
    rejection_reason: "Cultural fit concerns raised by hiring panel.",
    experience_text: "Four rounds done. Technical went well. The final culture round felt vague. Rejection email cited 'team fit' without specifics. The process took five weeks.",
    created_at: "2026-03-17T13:00:00Z",
  },
  {
    id: "s8",
    company: companies[7],
    role_title: "Java Developer",
    rejection_stage: "applied",
    rejection_reason: "Automated rejection, likely ATS filter.",
    experience_text: "Application was rejected within 48 hours. No human seems to have reviewed it. Resume was tailored to the JD. Suspect keyword mismatch in ATS.",
    created_at: "2026-02-14T10:00:00Z",
  },
  {
    id: "s9",
    company: companies[8],
    role_title: "Growth Product Manager",
    rejection_stage: "interviewed",
    rejection_reason: "Metrics framework not strong enough.",
    experience_text: "Two rounds. First was a product sense round which went well. Second was a metrics deep-dive. Was asked how I would measure the success of a new feature — my answer lacked structured frameworks.",
    created_at: "2026-03-05T09:00:00Z",
  },
  {
    id: "s10",
    company: companies[9],
    role_title: "ML Engineer",
    rejection_stage: "screened",
    rejection_reason: "Required on-site relocation, candidate could not comply.",
    experience_text: "Recruiter call went well. Was asked about relocation at the end. When I said I preferred remote for at least six months, the call ended shortly after. Email rejection arrived next day.",
    created_at: "2026-03-02T16:00:00Z",
  },
  {
    id: "s11",
    company: companies[0],
    role_title: "Staff Engineer",
    rejection_stage: "interviewed",
    rejection_reason: "Leadership and influence signals insufficient.",
    experience_text: "Six-round process over three weeks. Technical rounds were strong. The Googleyness and leadership round is where it fell apart. Hard to prepare for without internal guidance.",
    created_at: "2026-03-18T10:00:00Z",
  },
  {
    id: "s12",
    company: companies[1],
    role_title: "UX Designer",
    rejection_stage: "offered",
    rejection_reason: "Offer rescinded after background check delay.",
    experience_text: "Full design portfolio review, three interviews, then an offer. Background check took unusually long. After six weeks, was told the position was no longer available.",
    created_at: "2026-02-28T12:00:00Z",
  },
  {
    id: "s13",
    company: companies[2],
    role_title: "Solutions Architect",
    rejection_stage: "screened",
    rejection_reason: "Recruiter said candidate was overqualified.",
    experience_text: "15-minute recruiter screen. Mentioned current compensation, which was higher than the role's band. Was told I might find the role 'underwhelming'. Polite but clearly a mismatch on expectations.",
    created_at: "2026-02-25T11:00:00Z",
  },
  {
    id: "s14",
    company: companies[3],
    role_title: "Senior Android Developer",
    rejection_stage: "interviewed",
    rejection_reason: "Preferred candidate with Kotlin-first experience.",
    experience_text: "Two coding rounds and one design round. Was told feedback was positive overall but the team preferred someone with a Kotlin-first background rather than Java migration experience.",
    created_at: "2026-03-11T09:30:00Z",
  },
  {
    id: "s15",
    company: companies[4],
    role_title: "DevOps Engineer",
    rejection_stage: "applied",
    rejection_reason: "No response after 6 weeks.",
    experience_text: "Applied with a tailored resume. The role stayed open for months on LinkedIn. No response, no rejection. Still shows as active. Sent a follow-up email, also no response.",
    created_at: "2026-01-30T10:00:00Z",
  },
  {
    id: "s16",
    company: companies[5],
    role_title: "Data Analyst",
    rejection_stage: "interviewed",
    rejection_reason: "SQL performance tuning gaps identified.",
    experience_text: "Online assessment, then two interviews. SQL test included query optimisation questions. Got caught on index strategies for large tables. Rejection email was polite and included the specific gap.",
    created_at: "2026-03-14T14:00:00Z",
  },
  {
    id: "s17",
    company: companies[6],
    role_title: "Product Designer",
    rejection_stage: "screened",
    rejection_reason: "Portfolio did not align with current product focus.",
    experience_text: "Submitted portfolio as requested. Recruiter replied saying the work was strong but did not match the fintech design direction they were going for. No interview offered.",
    created_at: "2026-03-09T08:30:00Z",
  },
  {
    id: "s18",
    company: companies[7],
    role_title: "Business Analyst",
    rejection_stage: "interviewed",
    rejection_reason: "Communication clarity scored below threshold.",
    experience_text: "Panel interview with four people. Technical knowledge was adequate. Post-rejection feedback from HR indicated communication clarity was the deciding factor. No coaching or re-application guidance was offered.",
    created_at: "2026-03-06T15:00:00Z",
  },
  {
    id: "s19",
    company: companies[8],
    role_title: "Category Manager",
    rejection_stage: "applied",
    rejection_reason: "Position filled internally.",
    experience_text: "Applied through a referral link. Three weeks later, received a standard rejection email. Later found out through the referral that the role was filled by an internal transfer before external review began.",
    created_at: "2026-02-18T10:00:00Z",
  },
  {
    id: "s20",
    company: companies[9],
    role_title: "Software Engineer",
    rejection_stage: "interviewed",
    rejection_reason: "Final round performance did not meet hiring bar.",
    experience_text: "Four rounds. The first three were straightforward. The final round was with a principal engineer and covered distributed systems in depth. Performance on the CAP theorem trade-off question was the cited gap.",
    created_at: "2026-03-16T11:00:00Z",
  },
];

export function getRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date("2026-03-19T00:00:00Z");
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "1 month ago";
  return `${diffMonths} months ago`;
}
