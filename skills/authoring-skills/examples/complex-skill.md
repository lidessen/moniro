# Example: Complex Skill with Progressive Disclosure

This example shows a skill with multiple reference files using progressive disclosure.

## Table of Contents

- [Use Case](#use-case)
- [Directory Structure](#directory-structure)
- [SKILL.md](#skillmd)
- [Reference Files](#reference-files)
  - [reference/finance.md](#referencefinancemd)
  - [reference/sales.md](#referencesalesmd)
  - [reference/product.md](#referenceproductmd)
  - [reference/common-queries.md](#referencecommon-queriesmd)
- [Why This Is Complex](#why-this-is-complex)
- [Token Efficiency Analysis](#token-efficiency-analysis)
- [What Makes This Effective](#what-makes-this-effective)
- [Metadata Analysis](#metadata-analysis)
- [How Claude Uses This Skill](#how-claude-uses-this-skill)

## Use Case

A skill for querying and analyzing company data in BigQuery across multiple domains (finance, sales, product).

## Directory Structure

```
bigquery-analysis/
├── SKILL.md
└── reference/
    ├── finance.md
    ├── sales.md
    ├── product.md
    └── common-queries.md
```

## SKILL.md

````markdown
---
name: bigquery-analysis
description: Query and analyze company data in BigQuery across finance, sales, and product domains. Query revenue metrics, pipeline data, API usage. Use when analyzing company data, querying BigQuery, or asking about revenue, sales, or product metrics.
---

# BigQuery Analysis

## Quick Start

Connect and query BigQuery:

\```python
from google.cloud import bigquery

client = bigquery.Client(project='company-data')
query = "SELECT \* FROM finance.revenue WHERE date >= '2025-01-01'"
results = client.query(query).to_dataframe()
\```

## Available Datasets

**Finance**: Revenue, ARR, billing metrics
→ [reference/finance.md](reference/finance.md)

**Sales**: Opportunities, pipeline, accounts
→ [reference/sales.md](reference/sales.md)

**Product**: API usage, features, adoption
→ [reference/product.md](reference/product.md)

## Common Queries

See [reference/common-queries.md](reference/common-queries.md) for frequently used query patterns.

## Important Rules

**Always filter test data**:
\```sql
WHERE is_test = false
\```

**Date filters**:
Use `date` field, not `timestamp`. Format: `YYYY-MM-DD`

**Aggregations**:
Group by date for time-series:
\```sql
GROUP BY DATE_TRUNC(date, DAY)
ORDER BY date
\```

## Quick Search

Find specific metrics using grep:

\```bash
grep -i "revenue" reference/finance.md
grep -i "pipeline" reference/sales.md
grep -i "api usage" reference/product.md
\```
````

## reference/finance.md

````markdown
# Finance Data Reference

## Revenue Tables

### `finance.revenue_daily`

Daily revenue by customer and region.

**Schema**:

- `date` (DATE): Transaction date
- `customer_id` (STRING): Customer identifier
- `region` (STRING): Geographic region (NA, EU, APAC)
- `amount` (FLOAT): Revenue in USD
- `currency` (STRING): Original currency
- `is_test` (BOOLEAN): Test transaction flag

**Common queries**:

Revenue by region for Q4 2024:
\```sql
SELECT
region,
SUM(amount) as total_revenue,
COUNT(DISTINCT customer_id) as unique_customers
FROM finance.revenue_daily
WHERE date BETWEEN '2024-10-01' AND '2024-12-31'
AND is_test = false
GROUP BY region
ORDER BY total_revenue DESC
\```

Month-over-month growth:
\```sql
WITH monthly AS (
SELECT
DATE_TRUNC(date, MONTH) as month,
SUM(amount) as revenue
FROM finance.revenue_daily
WHERE is_test = false
GROUP BY month
)
SELECT
month,
revenue,
LAG(revenue) OVER (ORDER BY month) as prev_month,
(revenue - LAG(revenue) OVER (ORDER BY month)) / LAG(revenue) OVER (ORDER BY month) \* 100 as growth_pct
FROM monthly
ORDER BY month DESC
\```

### `finance.arr`

Annual Recurring Revenue by customer.

**Schema**:

- `date` (DATE): Snapshot date
- `customer_id` (STRING): Customer identifier
- `arr_amount` (FLOAT): ARR in USD
- `plan_type` (STRING): Subscription plan (starter, pro, enterprise)
- `is_test` (BOOLEAN): Test customer flag

**Common queries**:

Total ARR by plan:
\```sql
SELECT
plan_type,
SUM(arr_amount) as total_arr,
COUNT(customer_id) as customer_count
FROM finance.arr
WHERE date = CURRENT_DATE()
AND is_test = false
GROUP BY plan_type
\```

## Billing Tables

### `finance.invoices`

Invoice records.

**Schema**:

- `invoice_id` (STRING): Unique invoice ID
- `customer_id` (STRING): Customer identifier
- `date` (DATE): Invoice date
- `amount` (FLOAT): Invoice amount in USD
- `status` (STRING): paid, pending, failed
- `is_test` (BOOLEAN): Test invoice flag

**Common queries**:

Pending invoices:
\```sql
SELECT
customer_id,
SUM(amount) as total_pending
FROM finance.invoices
WHERE status = 'pending'
AND is_test = false
GROUP BY customer_id
HAVING total_pending > 1000
ORDER BY total_pending DESC
\```

## Important Notes

- **Always filter**: `WHERE is_test = false`
- **Currency**: All amounts in USD after conversion
- **Dates**: Use `date` field, not `created_at` timestamp
- **Time zones**: All dates in UTC
````

## reference/sales.md

````markdown
# Sales Data Reference

## Pipeline Tables

### `sales.opportunities`

Sales opportunities and deals.

**Schema**:

- `opportunity_id` (STRING): Unique opportunity ID
- `customer_name` (STRING): Prospective customer
- `stage` (STRING): Discovery, proposal, negotiation, closed_won, closed_lost
- `amount` (FLOAT): Deal value in USD
- `probability` (FLOAT): Win probability (0-1)
- `close_date` (DATE): Expected close date
- `owner_id` (STRING): Sales rep ID
- `created_at` (TIMESTAMP): Opportunity created time
- `is_test` (BOOLEAN): Test opportunity flag

**Common queries**:

Pipeline by stage:
\```sql
SELECT
stage,
COUNT(_) as count,
SUM(amount) as total_value,
SUM(amount _ probability) as weighted_value
FROM sales.opportunities
WHERE stage NOT IN ('closed_won', 'closed_lost')
AND is_test = false
GROUP BY stage
ORDER BY
CASE stage
WHEN 'discovery' THEN 1
WHEN 'proposal' THEN 2
WHEN 'negotiation' THEN 3
END
\```

Win rate by rep:
\```sql
WITH rep*stats AS (
SELECT
owner_id,
COUNT(*) as total*deals,
SUM(CASE WHEN stage = 'closed_won' THEN 1 ELSE 0 END) as won_deals,
SUM(CASE WHEN stage = 'closed_won' THEN amount ELSE 0 END) as won_amount
FROM sales.opportunities
WHERE stage IN ('closed_won', 'closed_lost')
AND is_test = false
GROUP BY owner_id
)
SELECT
owner_id,
total_deals,
won_deals,
ROUND(won_deals / total_deals * 100, 1) as win_rate_pct,
won_amount
FROM rep_stats
WHERE total_deals >= 5 -- Minimum deal count for meaningful win rate
ORDER BY win_rate_pct DESC
\```

### `sales.accounts`

Customer and prospect accounts.

**Schema**:

- `account_id` (STRING): Unique account ID
- `account_name` (STRING): Company name
- `industry` (STRING): Industry sector
- `employee_count` (INT): Company size
- `region` (STRING): Geographic region
- `status` (STRING): prospect, customer, churned
- `is_test` (BOOLEAN): Test account flag

**Common queries**:

Accounts by industry:
\```sql
SELECT
industry,
COUNT(\*) as account_count,
COUNT(CASE WHEN status = 'customer' THEN 1 END) as customer_count
FROM sales.accounts
WHERE is_test = false
GROUP BY industry
ORDER BY account_count DESC
\```
````

## reference/product.md

````markdown
# Product Data Reference

## Usage Tables

### `product.api_calls`

API usage by customer.

**Schema**:

- `timestamp` (TIMESTAMP): Call timestamp
- `customer_id` (STRING): Customer identifier
- `endpoint` (STRING): API endpoint called
- `method` (STRING): HTTP method (GET, POST, etc.)
- `response_code` (INT): HTTP response code
- `latency_ms` (INT): Response time in milliseconds
- `is_test` (BOOLEAN): Test API call flag

**Common queries**:

API usage by customer (last 30 days):
\```sql
SELECT
customer_id,
COUNT(\*) as total_calls,
COUNT(DISTINCT endpoint) as unique_endpoints,
AVG(latency_ms) as avg_latency,
SUM(CASE WHEN response_code >= 500 THEN 1 ELSE 0 END) as error_count
FROM product.api_calls
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
AND is_test = false
GROUP BY customer_id
ORDER BY total_calls DESC
LIMIT 100
\```

Top endpoints by usage:
\```sql
SELECT
endpoint,
COUNT(_) as call_count,
AVG(latency_ms) as avg_latency_ms,
ROUND(SUM(CASE WHEN response_code >= 400 THEN 1 ELSE 0 END) / COUNT(_) \* 100, 2) as error_rate_pct
FROM product.api_calls
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
AND is_test = false
GROUP BY endpoint
ORDER BY call_count DESC
LIMIT 20
\```

### `product.feature_usage`

Feature adoption and usage.

**Schema**:

- `date` (DATE): Usage date
- `customer_id` (STRING): Customer identifier
- `feature_name` (STRING): Feature identifier
- `usage_count` (INT): Times feature used
- `is_test` (BOOLEAN): Test usage flag

**Common queries**:

Feature adoption rate:
\```sql
WITH customer_base AS (
SELECT COUNT(DISTINCT customer_id) as total_customers
FROM finance.arr
WHERE date = CURRENT_DATE() AND is_test = false
),
feature_users AS (
SELECT
feature_name,
COUNT(DISTINCT customer_id) as users
FROM product.feature_usage
WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
AND is_test = false
GROUP BY feature_name
)
SELECT
f.feature_name,
f.users,
c.total_customers,
ROUND(f.users / c.total_customers \* 100, 1) as adoption_rate_pct
FROM feature_users f
CROSS JOIN customer_base c
ORDER BY adoption_rate_pct DESC
\```
````

## reference/common-queries.md

````markdown
# Common Query Patterns

## Time-Series Analysis

### Daily trend

\```sql
SELECT
DATE_TRUNC(date, DAY) as day,
SUM(amount) as daily_total
FROM finance.revenue_daily
WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
AND is_test = false
GROUP BY day
ORDER BY day
\```

### Week-over-week comparison

\```sql
WITH weekly AS (
SELECT
DATE_TRUNC(date, WEEK) as week,
SUM(amount) as revenue
FROM finance.revenue_daily
WHERE is_test = false
GROUP BY week
)
SELECT
week,
revenue,
LAG(revenue, 1) OVER (ORDER BY week) as prev_week,
revenue - LAG(revenue, 1) OVER (ORDER BY week) as week_change,
ROUND((revenue - LAG(revenue, 1) OVER (ORDER BY week)) / LAG(revenue, 1) OVER (ORDER BY week) \* 100, 1) as pct_change
FROM weekly
ORDER BY week DESC
LIMIT 12
\```

## Cohort Analysis

### Customer cohorts by signup month

\```sql
WITH first_purchase AS (
SELECT
customer_id,
DATE_TRUNC(MIN(date), MONTH) as cohort_month
FROM finance.revenue_daily
WHERE is_test = false
GROUP BY customer_id
),
monthly_revenue AS (
SELECT
fp.cohort_month,
DATE_TRUNC(r.date, MONTH) as revenue_month,
SUM(r.amount) as revenue
FROM finance.revenue_daily r
JOIN first_purchase fp ON r.customer_id = fp.customer_id
WHERE r.is_test = false
GROUP BY cohort_month, revenue_month
)
SELECT
cohort_month,
revenue_month,
revenue,
DATE_DIFF(revenue_month, cohort_month, MONTH) as months_since_signup
FROM monthly_revenue
ORDER BY cohort_month, revenue_month
\```

## Funnel Analysis

### Sales funnel conversion

\```sql
WITH funnel AS (
SELECT
COUNT(_) as total_opportunities,
COUNT(CASE WHEN stage IN ('proposal', 'negotiation', 'closed_won') THEN 1 END) as reached_proposal,
COUNT(CASE WHEN stage IN ('negotiation', 'closed_won') THEN 1 END) as reached_negotiation,
COUNT(CASE WHEN stage = 'closed_won' THEN 1 END) as closed_won
FROM sales.opportunities
WHERE created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
AND is_test = false
)
SELECT
total_opportunities,
reached_proposal,
ROUND(reached_proposal / total_opportunities _ 100, 1) as proposal*rate,
reached_negotiation,
ROUND(reached_negotiation / reached_proposal * 100, 1) as negotiation*rate,
closed_won,
ROUND(closed_won / reached_negotiation * 100, 1) as close_rate,
ROUND(closed_won / total_opportunities \* 100, 1) as overall_conversion
FROM funnel
\```
````

## Why This Is a Complex Skill

1. **Multiple domains**: Finance, sales, product (separate files)
2. **Progressive disclosure**: SKILL.md is navigation hub (~300 tokens)
3. **Detailed references**: Each domain file ~800 tokens
4. **Total content**: ~2700 tokens across all files
5. **Token efficiency**: Only relevant domain loaded per query

## Token Efficiency Analysis

### Query: "Show revenue by region for Q4"

**Files loaded**:

1. SKILL.md (~300 tokens) - Navigation
2. reference/finance.md (~800 tokens) - Finance schemas and queries

**Total**: ~1100 tokens

**Files NOT loaded**:

- reference/sales.md (saved ~800 tokens)
- reference/product.md (saved ~800 tokens)
- reference/common-queries.md (saved ~700 tokens)

**Efficiency**: Only 40% of skill content loaded, exactly what's needed.

### Query: "What's our sales pipeline by stage?"

**Files loaded**:

1. SKILL.md (~300 tokens)
2. reference/sales.md (~800 tokens)

**Total**: ~1100 tokens

**Files NOT loaded**: finance.md, product.md, common-queries.md (saved ~2300 tokens)

## What Makes This Skill Effective

1. **Clear domain separation**: Each file covers one domain
2. **Navigation hub**: SKILL.md provides overview and links
3. **Complete schemas**: Each table documented with schema and examples
4. **Common patterns**: Separate file for cross-cutting queries
5. **Quick search hints**: grep commands for fast lookup
6. **Critical rules prominent**: Test data filtering in SKILL.md

## Metadata Analysis

### Name

```yaml
name: bigquery-analysis
```

✓ Specific (not generic "data-analysis")
✓ 17 characters

### Description

```yaml
description: Query and analyze company data in BigQuery across finance, sales, and product domains. Query revenue metrics, pipeline data, API usage. Use when analyzing company data, querying BigQuery, or asking about revenue, sales, or product metrics.
```

✓ Specific capabilities: "query", "analyze", domains listed
✓ Clear triggers: "BigQuery", "revenue", "sales", "product metrics"
✓ 290 characters

## How Claude Uses This Skill

1. **User**: "Show me Q4 revenue by region"
2. **Discovery**: Matches "revenue"
3. **Load SKILL.md**: See it's finance data
4. **Navigate**: Read reference/finance.md
5. **Execute**: Use revenue_daily table schema and example query
6. **Result**: Query generated without loading sales/product data

**Efficient**: 2 file reads, ~1100 tokens, exactly what's needed.
