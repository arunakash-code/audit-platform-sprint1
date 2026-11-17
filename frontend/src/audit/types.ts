export type Counts = { total: number; tested: number; passed: number; failed: number; open_queries: number };

export type Client = {
  id: number;
  name: string;
  code: string | null;
  industry?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  status?: "active" | "inactive";
  engagements_count?: number;
};

export type Engagement = {
  id: number;
  client_id: number;
  client?: { id: number; name: string } & Partial<Client>;
  audit_type: "statutory" | "internal";
  frequency: "quarterly" | "annual";
  fiscal_year: number;
  period: string;
  period_start: string;
  period_end: string;
  status: "planning" | "in_progress" | "completed";
  notes: string | null;
  completed_at: string | null;
  label: string;
  fy_label: string;
  processes_count?: number;
  processes_completed?: number;
  controls_total?: number;
  controls_tested?: number;
  controls_failed?: number;
  open_queries?: number;
};

export type EngagementProcess = {
  id: number;
  engagement_id: number;
  process_id: number;
  process_code: string | null;
  process_name: string;
  status: "not_started" | "in_progress" | "completed";
  due_date: string | null;
  completed_at: string | null;
  assignee: { id: number; name: string } | null;
  counts: Counts;
  client?: string;
  engagement_label?: string;
};

export type Check = { id: number; description: string };

/** Testing recorded against one check of a control. */
export type CheckResult = {
  population: number | null;
  sample_size: number | null;
  result: "pass" | "fail" | null;
  notes: string | null;
};

export type Snapshot = {
  risk_id: number;
  risk_code: string | null;
  risk_title: string;
  risk_description?: string | null;
  risk_rating: "high" | "medium" | "low";
  control_code: string | null;
  control_title: string;
  control_description: string | null;
  nature: string | null;
  control_type: string | null;
  frequency: string | null;
  owner: string | null;
  is_key: boolean;
  checks: Check[];
};

export type Retest = {
  at: string;
  by: string;
  result: "pass" | "fail";
  sample_size: number | null;
  notes: string;
  previous_target_date: string | null;
};

export type ControlTest = {
  id: number;
  reference: string;
  engagement_process_id: number;
  snapshot: Snapshot;
  population: number | null;
  sample_size: number | null;
  result: "pass" | "fail" | null;
  check_results: Record<string, CheckResult>;
  test_notes: string | null;
  tested_by: { id: number; name: string } | null;
  tested_at: string | null;
  failure_reason: string | null;
  failed_samples: number | null;
  management_response: string | null;
  target_date: string | null;
  responsible_person: string | null;
  query_status: "open" | "closed" | null;
  retests: Retest[];
  closed_at: string | null;
};

export type RiskGroup = {
  risk_id: number;
  code: string | null;
  title: string;
  description?: string | null;
  rating: "high" | "medium" | "low";
  controls: ControlTest[];
};

export type QueryRow = {
  id: number;
  reference: string;
  client: string | null;
  engagement_id: number;
  engagement_label: string | null;
  engagement_process_id: number;
  process_name: string | null;
  assignee: string | null;
  assigned_to: number | null;
  risk_title: string | null;
  risk_rating: "high" | "medium" | "low" | null;
  control_code: string | null;
  control_title: string | null;
  sample_size: number | null;
  failed_samples: number | null;
  failure_reason: string | null;
  management_response: string | null;
  responsible_person: string | null;
  target_date: string | null;
  days_to_target: number | null;
  query_status: "open" | "closed";
  retest_count: number;
  retests: Retest[];
  tested_at: string | null;
  closed_at: string | null;
};

export type LibraryControl = {
  id: number;
  risk_id: number;
  code: string | null;
  title: string;
  description: string | null;
  nature: string | null;
  control_type: string | null;
  frequency: string | null;
  owner: string | null;
  is_key: boolean;
  checks: Check[];
};
export type LibraryRisk = { id: number; process_id: number; code: string | null; title: string; description: string | null; rating: "high" | "medium" | "low"; controls: LibraryControl[] };
export type LibraryProcess = { id: number; code: string | null; name: string; description: string | null; risks: LibraryRisk[] };

export type Meta = {
  clients: { id: number; name: string; code: string | null }[];
  processes: { id: number; code: string | null; name: string; risks_count: number; controls_count: number }[];
  testers: { id: number; name: string; email: string }[];
  options: {
    audit_types: string[];
    frequencies: string[];
    periods: Record<string, string[]>;
    fiscal_years: { value: number; label: string }[];
    current_fiscal_year: number;
    fy_start_month: number;
    risk_ratings: string[];
    control_natures: string[];
    control_types: string[];
    control_frequencies: string[];
  };
};
