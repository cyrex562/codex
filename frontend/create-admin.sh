#!/bin/bash
# First, register a new user (if registration is open)
curl -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' 2>&1

echo "Registration attempt done"

# Try login
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' 2>&1
