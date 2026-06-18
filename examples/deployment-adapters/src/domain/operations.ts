export interface MerchantOperator {
  id: string;
  name: string;
  role: string;
  region: string;
  openAlerts: number;
}

export interface OrderSignal {
  id: string;
  merchant: string;
  amount: number;
  status: "paid" | "review" | "at-risk";
  owner: string;
}

export interface Incident {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  owner: string;
  minutesOpen: number;
}

export interface CampaignMetric {
  id: string;
  label: string;
  value: string;
  trend: string;
}

export interface SupportTicket {
  id: string;
  merchant: string;
  issue: string;
  priority: "urgent" | "normal";
  sla: string;
}

export interface RegionPerformance {
  id: string;
  region: string;
  volume: string;
  approval: string;
  risk: string;
}

export interface PolicyLane {
  id: string;
  label: string;
  score: number;
  decision: string;
  owner: string;
}

export interface DecisionQueueItem {
  id: string;
  merchant: string;
  exposure: string;
  trigger: string;
  recommendedAction: string;
  owner: string;
  sla: string;
  status: "ready" | "needs-evidence" | "blocked";
}

export interface SettlementBatch {
  id: string;
  label: string;
  amount: string;
  releaseWindow: string;
  heldMerchants: number;
  decision: "release" | "partial hold" | "manual review";
}

export interface InsightRecommendation {
  id: string;
  merchant: string;
  impact: string;
  action: string;
  reason: string;
}

export interface CampaignSegment {
  id: string;
  name: string;
  audience: string;
  offer: string;
  state: "static" | "dynamic";
}

export interface InventoryReservation {
  id: string;
  sku: string;
  region: string;
  reserved: number;
  available: number;
}

export interface OperationsSnapshot {
  generatedAt: string;
  gmValue: string;
  approvalRate: string;
  riskQueue: number;
  p95Latency: string;
  operators: MerchantOperator[];
  orders: OrderSignal[];
  incidents: Incident[];
  regions: RegionPerformance[];
  policyLanes: PolicyLane[];
  decisionQueue: DecisionQueueItem[];
  settlementBatches: SettlementBatch[];
  recommendations: InsightRecommendation[];
}

export const operators: MerchantOperator[] = [
  {
    id: "op-1",
    name: "Ada Lovelace",
    role: "Risk lead",
    region: "APAC",
    openAlerts: 4,
  },
  {
    id: "op-2",
    name: "Grace Hopper",
    role: "Merchant success",
    region: "EMEA",
    openAlerts: 2,
  },
  {
    id: "op-3",
    name: "Katherine Johnson",
    role: "Settlement ops",
    region: "NA",
    openAlerts: 1,
  },
];

export const orderSignals: OrderSignal[] = [
  {
    id: "ord-8721",
    merchant: "Northstar Outdoor",
    amount: 128_400,
    status: "paid",
    owner: "Ada Lovelace",
  },
  {
    id: "ord-8722",
    merchant: "Blue Harbor Studio",
    amount: 42_900,
    status: "review",
    owner: "Grace Hopper",
  },
  {
    id: "ord-8723",
    merchant: "Atlas Foods",
    amount: 91_200,
    status: "at-risk",
    owner: "Katherine Johnson",
  },
];

export const incidents: Incident[] = [
  {
    id: "inc-104",
    severity: "high",
    title: "Atlas Foods payout requires manual review",
    owner: "Katherine Johnson",
    minutesOpen: 18,
  },
  {
    id: "inc-105",
    severity: "medium",
    title: "Blue Harbor velocity spike exceeded rule baseline",
    owner: "Grace Hopper",
    minutesOpen: 42,
  },
];

export const campaignMetrics: CampaignMetric[] = [
  {
    id: "conversion",
    label: "Checkout conversion",
    value: "18.4%",
    trend: "+2.1%",
  },
  {
    id: "aov",
    label: "Average order value",
    value: "$73.20",
    trend: "+$4.10",
  },
  {
    id: "inventory",
    label: "Reserved inventory",
    value: "71%",
    trend: "stable",
  },
];

export const supportTickets: SupportTicket[] = [
  {
    id: "sup-301",
    merchant: "Northstar Outdoor",
    issue: "Chargeback evidence requested",
    priority: "urgent",
    sla: "42m",
  },
  {
    id: "sup-302",
    merchant: "Blue Harbor Studio",
    issue: "Settlement account verification",
    priority: "normal",
    sla: "4h",
  },
];

export const regionPerformance: RegionPerformance[] = [
  {
    id: "apac",
    region: "APAC",
    volume: "$118.2k",
    approval: "98.4%",
    risk: "3 reviews",
  },
  {
    id: "emea",
    region: "EMEA",
    volume: "$76.8k",
    approval: "96.9%",
    risk: "2 reviews",
  },
  {
    id: "na",
    region: "North America",
    volume: "$67.5k",
    approval: "97.6%",
    risk: "1 review",
  },
];

export const policyLanes: PolicyLane[] = [
  {
    id: "velocity",
    label: "Velocity anomaly",
    score: 84,
    decision: "manual review",
    owner: "Risk rules",
  },
  {
    id: "settlement",
    label: "Settlement readiness",
    score: 92,
    decision: "auto release",
    owner: "Ledger",
  },
  {
    id: "chargeback",
    label: "Chargeback exposure",
    score: 71,
    decision: "collect evidence",
    owner: "Support",
  },
];

export const decisionQueue: DecisionQueueItem[] = [
  {
    id: "dq-901",
    merchant: "Atlas Foods",
    exposure: "$91.2k",
    trigger: "Payout velocity 3.4x above weekday baseline",
    recommendedAction: "Hold payout and request invoice evidence",
    owner: "Katherine Johnson",
    sla: "12m",
    status: "needs-evidence",
  },
  {
    id: "dq-902",
    merchant: "Blue Harbor Studio",
    exposure: "$42.9k",
    trigger: "New card mix with stale settlement account",
    recommendedAction: "Route merchant confirmation to success team",
    owner: "Grace Hopper",
    sla: "26m",
    status: "ready",
  },
  {
    id: "dq-903",
    merchant: "Northstar Outdoor",
    exposure: "$128.4k",
    trigger: "Clean risk score but chargeback evidence due",
    recommendedAction: "Release payment after evidence bundle is attached",
    owner: "Ada Lovelace",
    sla: "42m",
    status: "blocked",
  },
];

export const settlementBatches: SettlementBatch[] = [
  {
    id: "batch-apac-10",
    label: "APAC priority release",
    amount: "$118.2k",
    releaseWindow: "10:15-10:30",
    heldMerchants: 1,
    decision: "partial hold",
  },
  {
    id: "batch-emea-11",
    label: "EMEA marketplace sweep",
    amount: "$76.8k",
    releaseWindow: "11:00-11:20",
    heldMerchants: 2,
    decision: "manual review",
  },
  {
    id: "batch-na-12",
    label: "North America express",
    amount: "$67.5k",
    releaseWindow: "12:00-12:15",
    heldMerchants: 0,
    decision: "release",
  },
];

export const insightRecommendations: InsightRecommendation[] = [
  {
    id: "atlas",
    merchant: "Atlas Foods",
    impact: "+$11.7k protected GMV",
    action: "Hold payout and request invoice evidence",
    reason: "Order velocity exceeded the merchant's weekday baseline by 3.4x.",
  },
  {
    id: "blue-harbor",
    merchant: "Blue Harbor Studio",
    impact: "18m faster approval",
    action: "Route to Grace Hopper for merchant confirmation",
    reason: "The new card mix is legitimate but settlement account is stale.",
  },
];

export const campaignSegments: CampaignSegment[] = [
  {
    id: "vip",
    name: "VIP merchants",
    audience: "2,400 accounts",
    offer: "2.4% processing fee for 7 days",
    state: "static",
  },
  {
    id: "reactivation",
    name: "Dormant merchants",
    audience: "8,900 accounts",
    offer: "$25 sponsored checkout credit",
    state: "static",
  },
  {
    id: "scarce-inventory",
    name: "Scarce inventory",
    audience: "Live availability",
    offer: "Rendered by PPR region",
    state: "dynamic",
  },
];

export const inventoryReservations: InventoryReservation[] = [
  {
    id: "spring-card",
    sku: "Spring launch checkout credit",
    region: "APAC",
    reserved: 7140,
    available: 2860,
  },
  {
    id: "fee-waiver",
    sku: "Fee waiver bundle",
    region: "EMEA",
    reserved: 4810,
    available: 1190,
  },
  {
    id: "priority-settlement",
    sku: "Priority settlement slot",
    region: "NA",
    reserved: 920,
    available: 80,
  },
];

export function getOperationsSnapshot(): OperationsSnapshot {
  return {
    generatedAt: "2026-06-03T09:30:00.000Z",
    gmValue: "$262.5k",
    approvalRate: "97.8%",
    riskQueue: incidents.length,
    p95Latency: "184ms",
    operators,
    orders: orderSignals,
    incidents,
    regions: regionPerformance,
    policyLanes,
    decisionQueue,
    settlementBatches,
    recommendations: insightRecommendations,
  };
}
