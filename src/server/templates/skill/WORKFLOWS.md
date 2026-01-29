# ByteRover Workflows

## Pattern 1: Research Before Implementation

Use when starting new features or working in unfamiliar areas.

**Workflow:**
```
Query existing knowledge → Implement following patterns → Curate new decisions
```

**Example: Adding a new API endpoint**

```bash
# 1. Query for existing patterns
# Be SPECIFIC to get faster, more relevant results
brv query "What middleware chain is used for authenticated API endpoints?"
brv query "What is the standard error response format for API routes?"

# 2. Implement following discovered patterns
# ... write code ...

# 3. Curate decisions made
# Don't read the file first - let ByteRover read it via -f flag
brv curate "Added /api/users/profile endpoint. Uses authMiddleware for JWT validation, returns UserProfileDTO. Error handling follows ApiError pattern" -f src/api/routes/users.ts
```

**Example: Implementing a new React component**

```bash
# 1. Query patterns - specific questions save time
brv query "What data fetching hook pattern is used in list components?"
brv query "Are CSS modules or styled-components used for component styling?"

# 2. Implement
# ... write component ...

# 3. Curate with file reference - ByteRover reads the file
brv curate "Created UserAvatar component. Uses React Query for data fetching, CSS modules for styling. Follows existing pattern in src/components/common/" -f src/components/UserAvatar.tsx
```

## Pattern 2: Debug and Document

Use when fixing bugs to capture learnings and prevent recurrence.

**Workflow:**
```
Query known issues → Debug and fix → Curate root cause and solution
```

**Example: Fixing a race condition**

```bash
# 1. Query for context - be specific about the symptom
brv query "Are there known race condition patterns or AbortController usage in data fetching hooks?"

# 2. Debug and fix
# ... investigate, find root cause, implement fix ...

# 3. Curate the learning with structured format
brv curate "Bug: stale data after rapid navigation. Cause: useEffect cleanup not cancelling requests. Fix: AbortController with cleanup. Pattern: always abort fetch in useEffect cleanup" -f src/hooks/useUserData.ts
```

**Example: Fixing an authentication issue**

```bash
# 1. Specific query about the problem area
brv query "How are credentials and cookies configured in the API client fetch calls?"

# 2. Fix
# ... debug and fix ...

# 3. Curate with emphasis on the gotcha
brv curate "Bug: unexpected logouts. Cause: fetch missing credentials option. Fix: added 'credentials: include' to fetch config. IMPORTANT: all API calls must include credentials for cookie-based auth" -f src/lib/api-client.ts
```

## Pattern 3: Multi-File Changes

Use when changes span multiple files to maintain context.

**Example: Adding a new feature across layers**

```bash
# 1. Query architecture - specific about the layers
brv query "How are full-stack features organized across API routes, service layer, and React components?"

# 2. Implement across files
# ... write code ...

# 3. Curate with multiple files (max 5)
# Let ByteRover read all files - don't read them yourself first
# Specify the topics you want created
brv curate "Added user notifications feature. Create separate topics for: 1) API endpoint structure, 2) NotificationService business logic, 3) useNotifications React hook pattern, 4) NotificationBell UI component" -f src/api/notifications.ts -f src/services/NotificationService.ts -f src/hooks/useNotifications.ts -f src/components/NotificationBell.tsx
```

**Example: Database schema change with migrations**

```bash
# 1. Query migration patterns
brv query "What is the migration naming convention and how are schema changes tested?"

# 2. Implement
# ... create migration, update models, update queries ...

# 3. Multiple curates for different concerns - break down large context
brv curate "Added user_preferences table with JSONB settings column. Migration: 20240115_add_user_preferences" -f migrations/20240115_add_user_preferences.ts

brv curate "UserPreferences model with type-safe JSONB access. Includes validation for theme, notifications, locale settings" -f src/models/UserPreferences.ts

brv curate "Updated UserService to load/save preferences. Uses transaction for atomic updates with user record" -f src/services/UserService.ts
```

## Pattern 4: Updating Existing Knowledge

Use when changes make previous context outdated.

**Example: Refactoring authentication system**

```bash
# 1. Query current documented state
brv query "What is currently documented about authentication implementation and token handling?"

# 2. Implement refactor
# ... refactor code ...

# 3. Curate with explicit cleanup signal
# Tell ByteRover to clean up outdated context
brv curate "OUTDATED: Previous auth used session cookies stored in Redis. NEW: Migrated to JWT with refresh tokens. Access token in memory (15min), refresh token in httpOnly cookie (7d). Remove/update any session-based auth context in the tree" -f src/auth/jwt.ts -f src/auth/refresh.ts
```

**Example: Replacing a library**

```bash
# 1. Query what's documented about the old library
brv query "What patterns are documented for moment.js date handling?"

# 2. Implement replacement
# ... replace library usage ...

# 3. Curate the replacement with cleanup signal
brv curate "REPLACED: Removed moment.js (bloated, mutable). Now using date-fns (tree-shakeable, immutable). Clean up any moment.js context. New patterns: format(date, 'yyyy-MM-dd'), parseISO(string), differenceInDays(date1, date2)" -f src/utils/dates.ts
```

**Example: API versioning change**

```bash
# Curate with explicit version context
brv curate "OUTDATED: API v1 endpoints deprecated. NEW: All endpoints now v2 with breaking changes. v2 uses camelCase response keys, pagination via cursor (not offset), errors include requestId. Update any v1 API context" -f src/api/v2/routes.ts
```

## Pattern 5: Comprehensive Documentation

Use when documenting complex systems that need detailed breakdown.

**Example: Documenting a payment module**

```bash
# Break into multiple curates - don't try to capture everything in one
# Specify structure and detail level for each topic

# Overview first
brv curate "Payment module overview: Stripe integration with webhooks for subscription management. Create 4 separate detailed topics covering the full payment lifecycle" -f src/payments/

# Topic 1 - detailed with line count guidance
brv curate "Topic: Payment checkout flow. Cover: 1) cart validation, 2) createPaymentIntent call, 3) client-side confirmation, 4) success/failure handling. Include error scenarios. At least 50 lines of detailed documentation" -f src/payments/checkout.ts -f src/payments/intent.ts

# Topic 2 - webhook handling
brv curate "Topic: Stripe webhook handling. Cover: 1) signature verification with STRIPE_WEBHOOK_SECRET, 2) idempotency with processed_events table, 3) event types (payment_intent.succeeded, payment_intent.failed, customer.subscription.*). At least 40 lines" -f src/payments/webhooks.ts

# Topic 3 - subscription management
brv curate "Topic: Subscription lifecycle. Cover: trial period handling, upgrade/downgrade proration, cancellation with grace period, reactivation flow" -f src/payments/subscriptions.ts

# Topic 4 - error handling
brv curate "Topic: Payment error handling. Cover: StripeError types (CardError, InvalidRequestError, APIError), retry logic for transient failures, user-facing error messages mapping" -f src/payments/errors.ts
```

**Example: Documenting a state management system**

```bash
# Multiple focused curates instead of one massive one

brv curate "State management overview: Using Zustand with persistence middleware. Create topics for: store structure, async actions, persistence, devtools integration" -f src/store/

brv curate "Topic: Store structure. Separate stores per domain (userStore, cartStore, uiStore). Each store follows pattern: state interface, actions, selectors. No cross-store dependencies" -f src/store/userStore.ts -f src/store/cartStore.ts

brv curate "Topic: Async actions. Pattern: set loading -> try/catch -> set data/error -> clear loading. All API calls go through apiClient. Optimistic updates for cart operations" -f src/store/cartStore.ts -f src/store/actions/

brv curate "Topic: Persistence. userStore persisted to localStorage (excluding sensitive data). cartStore persisted to sessionStorage. Custom serializer excludes functions and timestamps" -f src/store/middleware/persist.ts
```

## Pattern 6: Exploratory Documentation

Use when you need to document an unfamiliar codebase area.

**Example: Understanding and documenting an existing module**

```bash
# 1. Query what's already known
brv query "What is documented about the notification system and real-time updates?"

# 2. Explore the code (agent reads files to understand)
# ... read and understand the code ...

# 3. Curate in chunks as you understand different parts
# First curate: high-level architecture
brv curate "Notification system uses WebSocket for real-time delivery with Redis pub/sub for horizontal scaling. Three components: NotificationService (creation/storage), NotificationGateway (WebSocket), NotificationWorker (background processing)" -f src/notifications/

# Second curate: specific implementation detail
brv curate "WebSocket authentication: JWT token passed in connection query params, validated on connect, stored in socket.data. Rooms: user_{id} for personal, team_{id} for team broadcasts" -f src/notifications/NotificationGateway.ts

# Third curate: gotchas discovered
brv curate "Notification gotchas: 1) Must call gateway.joinRoom after auth, 2) Unread count cached in Redis (5min TTL) - call invalidateUnreadCount after marking read, 3) Batch notifications throttled to max 10/second per user" -f src/notifications/NotificationService.ts
```

## What to Curate

**Do curate:**
- Architecture decisions: "Chose Redis for sessions because of horizontal scaling"
- Patterns: "All forms use react-hook-form with zod. Pattern in LoginForm.tsx"
- Non-obvious conventions: "File uploads go to /tmp first, then S3 after validation"
- Bug root causes: "Memory leak from event listeners not removed on unmount"
- Gotchas: "PostgreSQL JSONB queries need explicit casting for arrays"
- Replacements: "OUTDATED: X, NEW: Y" when refactoring

**Don't curate:**
- Obvious facts: "Uses TypeScript", "Has a README"
- Temporary states: "Currently debugging X"
- Personal preferences: "I prefer tabs"
- Trivial changes: "Fixed typo in comment"
