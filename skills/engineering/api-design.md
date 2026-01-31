# API Design

Creating interfaces that are intuitive, consistent, and evolvable.

## Table of Contents

- [Design Principles](#design-principles)
- [REST API Guidelines](#rest-api-guidelines)
- [Error Handling](#error-handling)
- [Versioning Strategies](#versioning-strategies)
- [Documentation](#documentation)

## Design Principles

### Consistency

Similar operations work similarly across the API.

```
# Consistent naming
GET  /users/:id      → GET  /orders/:id      → GET  /products/:id
POST /users          → POST /orders          → POST /products

# Consistent response structure
{ "data": {...}, "meta": {...} }
```

### Predictability

Behavior matches what users expect.

```
# Predictable: DELETE returns 204 No Content
DELETE /users/123 → 204

# Predictable: POST returns created resource with 201
POST /users → 201 { "id": 124, "name": "..." }

# Predictable: GET with invalid ID returns 404
GET /users/99999 → 404 { "error": "User not found" }
```

### Simplicity

Easy things are easy. Complex things are possible.

```
# Simple case: just works
GET /users

# Complex case: available via query params
GET /users?status=active&sort=-created_at&limit=50&include=orders
```

### Evolvability

Can add features without breaking existing clients.

- Add new fields (don't remove old ones without deprecation)
- Add new endpoints (don't change existing semantics)
- Use versioning for breaking changes

## REST API Guidelines

### Resource Naming

```
# Use nouns, not verbs
✓ GET /users
✗ GET /getUsers

# Use plurals
✓ /users, /orders, /products
✗ /user, /order, /product

# Use kebab-case for multi-word
✓ /user-profiles
✗ /userProfiles, /user_profiles

# Nest for relationships (max 2 levels)
✓ /users/:id/orders
✓ /orders/:id/items
✗ /users/:id/orders/:oid/items/:iid/details
```

### HTTP Methods

| Method | Purpose | Idempotent | Request Body | Success Code |
|--------|---------|------------|--------------|--------------|
| GET    | Read    | Yes        | No           | 200          |
| POST   | Create  | No         | Yes          | 201          |
| PUT    | Replace | Yes        | Yes          | 200          |
| PATCH  | Update  | No*        | Yes          | 200          |
| DELETE | Delete  | Yes        | No           | 204          |

*PATCH can be idempotent depending on implementation

### Query Parameters

```
# Filtering
GET /users?status=active&role=admin

# Sorting (- for descending)
GET /users?sort=name
GET /users?sort=-created_at

# Pagination
GET /users?page=2&limit=20
GET /users?offset=20&limit=20
GET /users?cursor=eyJpZCI6MTIzfQ==

# Field selection
GET /users?fields=id,name,email

# Including related resources
GET /users?include=orders,profile

# Search
GET /users?q=john
GET /users?search=john@example.com
```

### Response Structure

**Single resource**:
```json
{
  "data": {
    "id": "123",
    "type": "user",
    "attributes": {
      "name": "John",
      "email": "john@example.com"
    }
  }
}
```

**Collection**:
```json
{
  "data": [
    { "id": "123", "name": "John" },
    { "id": "124", "name": "Jane" }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 20
  }
}
```

**Simpler alternative** (if JSON:API is overkill):
```json
{
  "user": {
    "id": "123",
    "name": "John"
  }
}

{
  "users": [...],
  "total": 150,
  "page": 1
}
```

## Error Handling

### HTTP Status Codes

**2xx: Success**
- 200 OK - Request succeeded
- 201 Created - Resource created
- 204 No Content - Success with no body (DELETE)

**4xx: Client Error**
- 400 Bad Request - Invalid request syntax
- 401 Unauthorized - Authentication required
- 403 Forbidden - Authenticated but not authorized
- 404 Not Found - Resource doesn't exist
- 409 Conflict - Conflict with current state
- 422 Unprocessable Entity - Validation failed

**5xx: Server Error**
- 500 Internal Server Error - Unexpected error
- 502 Bad Gateway - Upstream service error
- 503 Service Unavailable - Temporary overload

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request was invalid",
    "details": [
      {
        "field": "email",
        "message": "must be a valid email address"
      },
      {
        "field": "age",
        "message": "must be at least 18"
      }
    ]
  }
}
```

### Error Codes

Use machine-readable codes alongside human messages:

```json
{
  "error": {
    "code": "USER_NOT_FOUND",
    "message": "User with ID 123 was not found"
  }
}
```

Common error codes:
- `VALIDATION_ERROR` - Input validation failed
- `NOT_FOUND` - Resource doesn't exist
- `UNAUTHORIZED` - Authentication required
- `FORBIDDEN` - Not authorized for this action
- `CONFLICT` - Conflicts with existing resource
- `RATE_LIMITED` - Too many requests

## Versioning Strategies

### URL Path Versioning

```
GET /v1/users
GET /v2/users
```

**Pros**: Explicit, easy to route
**Cons**: URL pollution, harder to evolve

### Header Versioning

```
GET /users
Accept: application/vnd.api+json; version=2
```

**Pros**: Clean URLs
**Cons**: Less visible, harder to test in browser

### Query Parameter Versioning

```
GET /users?version=2
```

**Pros**: Easy to use
**Cons**: Optional parameter complications

### Recommendation

**For most APIs**: URL path versioning (`/v1/`)
- Most explicit and understandable
- Easy for developers to use
- Simple routing

**Version bump rules**:
- Breaking change → New version
- Additive change → Same version
- Bug fix → Same version

## Documentation

### Essential Documentation

**Getting started**:
- Authentication
- Base URL
- Rate limits
- Quick example

**Endpoint reference**:
- URL and method
- Parameters (path, query, body)
- Response format
- Error codes
- Example request/response

### OpenAPI Example

```yaml
paths:
  /users/{id}:
    get:
      summary: Get user by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: User found
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '404':
          description: User not found
```

### Example Request/Response

Always include examples:

```
# Request
GET /users/123
Authorization: Bearer <token>

# Response (200 OK)
{
  "id": "123",
  "name": "John Doe",
  "email": "john@example.com",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Changelog

Document API changes:

```markdown
## v2.1.0 (2024-02-01)
- Added `include` parameter to GET /users
- Added `profile` field to user response

## v2.0.0 (2024-01-01) - BREAKING
- Changed pagination from offset to cursor-based
- Renamed `user_name` to `username`
```
