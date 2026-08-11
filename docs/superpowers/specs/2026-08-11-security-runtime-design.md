# Security and Real MongoDB Runtime Design

## Goal

Remove the retired GitLab credential, restrict mutable gallery and streaming operations to the existing administrator account, and verify the application against a real MongoDB instance.

## Decisions

- Authentication uses the existing Flask-Login `User.is_admin()` model. There is no additional passcode or new user role.
- A shared `admin_required` decorator returns JSON `403` responses. It protects artwork updates and every streaming route that creates, controls, or deletes stream state.
- Stream identifiers are limited to safe filename-like values (letters, numbers, `_`, and `-`, max 64 characters). This prevents filesystem path traversal before any directory or FFmpeg operation.
- The retired GitLab token is removed from the tracked test script. Existing public Git history cannot be safely rewritten as part of this change; the token must be revoked separately.
- The application has no in-memory-database configuration branch or dependency. The app connects via `MONGODB_URI` when set, otherwise to the configured real MongoDB host and port.
- `seed_and_serve.py` uses the real app factory and database connection. It seeds only an empty database, then runs the Socket.IO server.
- Integration tests require `MONGODB_URI` and use a dedicated `metamuseum_test` database. CI starts a temporary `mongo:7` container on a private Docker network and runs the app smoke test and pytest suite against it.

## Error Handling

- Anonymous or non-admin write/control requests return `403` JSON without changing state.
- Invalid stream IDs return `400` JSON before filesystem or FFmpeg access.
- A missing `MONGODB_URI` causes integration tests to fail early with a clear message instead of silently using an in-memory database.

## Verification

- Tests prove anonymous artwork PATCH and streaming POST requests are denied, while an authenticated admin can update an element.
- Tests prove unsafe stream IDs are rejected.
- Tests execute seeding against real MongoDB and confirm it creates the expected initial records once.
- Docker Compose starts the local app and MongoDB; CI runs the same real-database smoke path.
