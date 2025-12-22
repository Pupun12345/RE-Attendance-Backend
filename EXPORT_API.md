# Export All Data API

## Overview

Simple GET API endpoint that fetches all data from production database and returns it in a single JSON response.

## Endpoint

```
GET /api/v1/export/all?email=admin@example.com&password=password123
```

## Authentication

- **Required**: Yes (Bearer token for admin)
- **Query Parameters**: `email` and `password` (for production API authentication)

## Usage

### Basic Request

```bash
curl -X GET "http://localhost:3000/api/v1/export/all?email=admin@example.com&password=password123" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Save to File

```bash
curl -X GET "http://localhost:3000/api/v1/export/all?email=admin@example.com&password=password123" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -o production-data.json
```

## Response Format

```json
{
  "success": true,
  "message": "Exported 150 records from production database",
  "summary": {
    "users": 25,
    "attendance": 100,
    "complaints": 15,
    "holidays": 5,
    "overtime": 5,
    "total": 150
  },
  "data": {
    "users": [...],
    "attendance": [...],
    "complaints": [...],
    "holidays": [...],
    "overtime": [...],
    "errors": []
  }
}
```

## What Gets Exported

- **Users**: All users from production
- **Attendance**: Last 12 months of attendance records
- **Complaints**: All complaints
- **Holidays**: All holidays
- **Overtime**: All overtime records

## Import to Local MongoDB

After getting the JSON response, you can extract each collection and import:

```bash
# Get the data
curl -X GET "http://localhost:3000/api/v1/export/all?email=admin@example.com&password=password123" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -o production-data.json

# Extract users and import
cat production-data.json | jq '.data.users' > users.json
mongoimport --uri="mongodb://localhost:27017/your-db" --collection=users --file=users.json --jsonArray

# Extract attendance and import
cat production-data.json | jq '.data.attendance' > attendance.json
mongoimport --uri="mongodb://localhost:27017/your-db" --collection=attendance --file=attendance.json --jsonArray

# And so on for other collections...
```

## Production URL

The API connects to:
```
https://re-attendance-backend-264138863806.europe-west1.run.app
```

## Notes

- Single GET request returns all data
- All collections in one JSON response
- Simple and straightforward
- Admin authentication required

