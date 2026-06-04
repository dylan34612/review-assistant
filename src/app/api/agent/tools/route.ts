import { NextResponse } from "next/server";

const tools = [
  {
    type: "function",
    function: {
      name: "list_review_tasks",
      description:
        "List review tasks. Marks any pending/snoozed tasks as due if their due date has passed. Returns all tasks with product info, status, rating, and draft text.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "due", "drafted", "completed", "skipped", "snoozed"],
            description: "Filter by status. Omit to return all tasks."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "draft_review",
      description:
        "Generate an AI-written review draft for a task using the user's notes and star rating. The task moves to 'drafted' status and the draft text is saved.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Review task ID" },
          userBlurb: {
            type: "string",
            description: "User's notes or thoughts about the product (at least 3 characters)"
          },
          rating: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "Star rating 1–5"
          }
        },
        required: ["id", "userBlurb", "rating"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "complete_review",
      description:
        "Mark a review task as completed with approved review text and rating. Use this after drafting to finalize the review.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Review task ID" },
          approvedReview: {
            type: "string",
            description: "The final review text to be saved (at least 3 characters)"
          },
          rating: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "Star rating 1–5"
          }
        },
        required: ["id", "approvedReview", "rating"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "skip_review",
      description: "Skip/dismiss a review task. The task moves to 'skipped' status and will not appear in the queue.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Review task ID" }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "snooze_review",
      description:
        "Snooze a review task for a given number of days. The task moves back to 'snoozed' and re-enters the queue when the new due date arrives.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Review task ID" },
          days: {
            type: "integer",
            minimum: 1,
            maximum: 90,
            description: "Number of days to snooze. Defaults to the configured defaultSnoozeDays setting."
          }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_purchases",
      description: "List recent purchases with product and review status. Returns up to 200 most recent entries.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_purchase",
      description:
        "Manually add a purchase to the system. The product will be enriched and a review task will be created automatically.",
      parameters: {
        type: "object",
        properties: {
          merchant: { type: "string", description: "Merchant name (e.g. 'Amazon', 'Walmart')" },
          title: { type: "string", description: "Product title (at least 2 characters)" },
          productUrl: { type: "string", description: "URL to the product page (optional)" },
          price: { type: "number", description: "Price paid in USD (optional)" },
          purchasedAt: {
            type: "string",
            description: "ISO 8601 purchase date (optional, defaults to now)"
          },
          deliveredAt: {
            type: "string",
            description: "ISO 8601 delivery date (optional, used to calculate review due date)"
          }
        },
        required: ["merchant", "title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_settings",
      description:
        "Get all application settings including notifications, privacy, review timing, IMAP, Gemini, and OpenAI configuration.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_settings",
      description:
        "Update one or more setting groups. Provide an object with any of the allowed setting keys as top-level keys.",
      parameters: {
        type: "object",
        properties: {
          notifications: {
            type: "object",
            description:
              "Notification settings (pushEnabled, emailEnabled, digestMode, quietHoursStart, quietHoursEnd, maxRemindersPerItem, reminderIntervalDays, defaultSnoozeDays)"
          },
          privacy: {
            type: "object",
            description: "Privacy settings (llmReceiptFallback, sendOrderIdsToLlm, sendEmailMetadataToLlm)"
          },
          reviewTiming: {
            type: "object",
            description: "Review timing settings (defaultDelayDays)"
          },
          gemini: {
            type: "object",
            description: "Gemini settings (model)"
          },
          openai: {
            type: "object",
            description: "OpenAI-compatible settings (baseUrl, model, apiKey, maxTokens)"
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_logs",
      description:
        "Search email processing logs. Returns processed messages with their parser events, item counts, and error details.",
      parameters: {
        type: "object",
        properties: {
          q: {
            type: "string",
            description: "Search query to filter by email subject or sender (optional)"
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 2000,
            description: "Max number of log entries to return (default 250)"
          }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "trigger_worker_scan",
      description:
        "Trigger an immediate worker cycle: scan the IMAP mailbox for new receipts, mark tasks as due, and send pending notifications. Returns scan statistics.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  }
];

export async function GET() {
  return NextResponse.json({ tools });
}
