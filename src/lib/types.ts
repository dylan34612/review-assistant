export type NotificationSettings = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  emailFallbackEnabled: boolean;
  digestMode: "off" | "daily" | "weekly";
  quietHoursStart: string;
  quietHoursEnd: string;
  maxRemindersPerItem: number;
  reminderIntervalDays: number;
  defaultSnoozeDays: number;
};

export type PrivacySettings = {
  llmReceiptFallback: "off" | "per-message" | "known-merchants";
  sendOrderIdsToLlm: boolean;
  sendEmailMetadataToLlm: boolean;
};

export type ReviewTimingSettings = {
  defaultDelayDays: number;
};

export type ExtractedItem = {
  merchant: string;
  orderId?: string;
  title: string;
  productUrl?: string;
  imageUrl?: string;
  price?: number;
  currency?: string;
  quantity?: number;
  purchasedAt?: string;
  deliveredAt?: string;
  externalId?: string;
  brand?: string;
  raw: Record<string, unknown>;
};

export type ProductSnapshot = {
  title: string;
  merchant: string;
  canonicalUrl?: string;
  externalId?: string;
  brand?: string;
  imageUrl?: string;
  description?: string;
  bullets?: string[];
  price?: number;
  currency?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  details?: Record<string, string>;
  source: "email" | "metadata" | "api";
};

export type ReviewTaskRow = {
  id: string;
  status: string;
  due_at: string;
  delay_days: number;
  category: string;
  category_confidence: string;
  user_blurb: string | null;
  rating: number | null;
  generated_draft: string | null;
  approved_review: string | null;
  reminder_count: number;
  subject_id: string;
  merchant: string;
  title: string;
  brand: string | null;
  image_url: string | null;
  canonical_url: string | null;
  product_snapshot: ProductSnapshot;
  reviewed_at: string | null;
};
