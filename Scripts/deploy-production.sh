#!/bin/bash

# Production Deployment Script for Statly with Enhanced Socket.IO
# This script ensures proper deployment of both Next.js app and Socket.IO server

set -e  # Exit on any error

echo "🚀 Starting production deployment for Statly..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

load_environment_files() {
    print_status "Loading environment files..."

    local env_files=()

    if [ "${NODE_ENV:-production}" = "production" ]; then
        env_files=(
            ".env.production.local"
            ".env.production"
            ".env"
        )
    else
        env_files=(
            ".env.production.local"
            ".env.production"
            ".env.local"
            ".env"
        )
    fi

    set -a
    for env_file in "${env_files[@]}"; do
        if [ -f "$env_file" ]; then
            # shellcheck disable=SC1090
            source "$env_file"
            print_status "Loaded environment from $env_file"
        fi
    done
    set +a
}

hydrate_firebase_env_from_base64() {
    if [ -n "$FIREBASE_SERVICE_ACCOUNT_JSON_BASE64" ] && [ -z "$FIREBASE_PROJECT_ID" -o -z "$FIREBASE_CLIENT_EMAIL" -o -z "$FIREBASE_PRIVATE_KEY" ]; then
        print_status "Deriving Firebase service account fields from FIREBASE_SERVICE_ACCOUNT_JSON_BASE64"
        local decoded
        decoded=$(node -e '
          const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64;
          if (!raw) process.exit(1);
          const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
          const payload = {
            projectId: parsed.project_id ?? parsed.projectId ?? "",
            clientEmail: parsed.client_email ?? parsed.clientEmail ?? "",
            privateKey: parsed.private_key ?? parsed.privateKey ?? "",
          };
          process.stdout.write(JSON.stringify(payload));
        ') || return 1

        export FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-$(printf '%s' "$decoded" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(data.projectId || "");')}"
        export FIREBASE_CLIENT_EMAIL="${FIREBASE_CLIENT_EMAIL:-$(printf '%s' "$decoded" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(data.clientEmail || "");')}"
        export FIREBASE_PRIVATE_KEY="${FIREBASE_PRIVATE_KEY:-$(printf '%s' "$decoded" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(data.privateKey || "");')}"
    fi
}

hydrate_auth_env() {
    if [ -z "$JWT_SECRET" ] && [ -n "$NEXTAUTH_SECRET" ]; then
        export JWT_SECRET="$NEXTAUTH_SECRET"
        print_status "Using NEXTAUTH_SECRET as JWT_SECRET"
    fi
}

validate_auth_bypass_env() {
    if [ "${NODE_ENV:-production}" = "production" ]; then
        if [ "${BYPASS_AUTH:-}" = "true" ] || [ "${NEXT_PUBLIC_BYPASS_AUTH:-}" = "true" ]; then
            print_error "Auth bypass flags must be disabled in production (BYPASS_AUTH/NEXT_PUBLIC_BYPASS_AUTH)"
            exit 1
        fi
    fi
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "This script must be run from the project root directory"
    exit 1
fi

# Check if required tools are installed
check_dependencies() {
    print_status "Checking dependencies..."
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    if ! command -v pm2 &> /dev/null; then
        print_warning "PM2 is not installed. Installing..."
        npm install -g pm2
    fi
    
    print_success "Dependencies check passed"
}

# Validate environment configuration
validate_environment() {
    print_status "Validating environment configuration..."
    
    # Check required environment variables
    required_vars=(
        "DATABASE_URL"
        "FIREBASE_PROJECT_ID"
        "FIREBASE_PRIVATE_KEY"
        "FIREBASE_CLIENT_EMAIL"
        "JWT_SECRET"
    )
    
    missing_vars=()
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        print_error "Missing required environment variables: ${missing_vars[*]}"
        exit 1
    fi
    
    # Check Socket.IO configuration
    if [ -z "$SOCKET_PORT" ]; then
        export SOCKET_PORT=3002
        print_warning "SOCKET_PORT not set, using default: 3002"
    fi
    
    if [ -z "$ALLOWED_ORIGINS" ]; then
        export ALLOWED_ORIGINS="https://yourdomain.com,https://www.yourdomain.com"
        print_warning "ALLOWED_ORIGINS not set, using default"
    fi
    
    print_success "Environment validation passed"
}

# Build the application
build_application() {
    print_status "Building Next.js application..."
    
    # Clean previous builds
    npm run clean
    
    # Install dependencies
    print_status "Installing dependencies..."
    npm ci --production=false
    
    # Build the application
    print_status "Building application..."
    npm run build
    
    if [ $? -eq 0 ]; then
        print_success "Application built successfully"
    else
        print_error "Application build failed"
        exit 1
    fi
}

# Build Socket.IO server
build_socket_server() {
    print_status "Building Socket.IO server..."
    
    # Build the Socket.IO server
    npm run worker:build
    
    if [ $? -eq 0 ]; then
        print_success "Socket.IO server built successfully"
    else
        print_error "Socket.IO server build failed"
        exit 1
    fi
}

# Deploy with PM2
deploy_with_pm2() {
    print_status "Deploying with PM2..."
    
    # Create ecosystem file
    cat > ecosystem.config.js << EOF
module.exports = {
  apps: [
    {
      name: 'statly-nextjs',
      script: 'npm',
      args: 'start',
      cwd: './',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './logs/nextjs-error.log',
      out_file: './logs/nextjs-out.log',
      log_file: './logs/nextjs-combined.log',
      time: true,
      max_memory_restart: '1G',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'statly-socketio',
      script: './dist/server/socketioServer.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        SOCKET_PORT: ${SOCKET_PORT}
      },
      env_production: {
        NODE_ENV: 'production',
        SOCKET_PORT: ${SOCKET_PORT}
      },
      error_file: './logs/socketio-error.log',
      out_file: './logs/socketio-out.log',
      log_file: './logs/socketio-combined.log',
      time: true,
      max_memory_restart: '512M',
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '10s'
    }
  ]
};
EOF
    
    # Create logs directory
    mkdir -p logs
    
    # Deploy with PM2
    pm2 start ecosystem.config.js --env production
    
    # Save PM2 configuration
    pm2 save
    
    # Setup PM2 startup script
    pm2 startup
    
    print_success "PM2 deployment completed"
}

# Setup reverse proxy (Nginx example)
setup_nginx() {
    print_status "Setting up Nginx configuration..."
    
    # Create Nginx configuration
    cat > nginx.conf << EOF
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    # SSL configuration (update with your certificate paths)
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    
    # TLS security configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers on;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Next.js application
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
    
    # Socket.IO WebSocket endpoint
    location /socket.io/ {
        proxy_pass http://localhost:${SOCKET_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://localhost:${SOCKET_PORT};
        proxy_set_header Host \$host;
    }
    
    # Static files
    location /_next/static/ {
        alias ${APP_DIR:-$(pwd)}/.next/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/javascript
        application/xml+rss
        application/json;
}
EOF
    
    # Validate static files alias path
    STATIC_DIR="${APP_DIR:-$(pwd)}/.next/static"
    if [ ! -d "$STATIC_DIR" ]; then
        print_error "Static directory not found: $STATIC_DIR"
        print_error "Ensure your build has created .next/static and APP_DIR is set correctly."
        exit 1
    fi

    print_warning "Nginx configuration created. Please:"
    print_warning "1. Update the server_name and SSL certificate paths"
    print_warning "2. Copy this configuration to /etc/nginx/sites-available/"
    print_warning "3. Enable the site and restart Nginx"
    print_warning "4. Update the static file path in the Nginx config to match your deployment directory"
}

# Health check
health_check() {
    print_status "Performing health check..."
    
    # Wait for services to start
    sleep 10
    
    HOST=${HOST:-localhost}
    NEXT_PORT=${NEXT_PORT:-3000}
    SOCKET_PORT=${SOCKET_PORT:-3002}
    
    # Check Next.js
    if curl -f http://$HOST:$NEXT_PORT > /dev/null 2>&1; then
        print_success "Next.js application is running"
    else
        print_error "Next.js application is not responding"
        exit 1
    fi
    
    # Check Socket.IO
    if curl -f http://$HOST:${SOCKET_PORT}/health > /dev/null 2>&1; then
        print_success "Socket.IO server is running"
    else
        print_error "Socket.IO server is not responding"
        exit 1
    fi
    
    print_success "Health check passed"
}

# Main deployment function
main() {
    print_status "Starting production deployment..."
    
    check_dependencies
    load_environment_files
    hydrate_firebase_env_from_base64
    hydrate_auth_env
    validate_auth_bypass_env
    validate_environment
    build_application
    build_socket_server
    deploy_with_pm2
    setup_nginx
    health_check
    
    print_success "Production deployment completed successfully!"
    print_status "Your application is now running at:"
    print_status "- Next.js: http://localhost:3000"
    print_status "- Socket.IO: http://localhost:${SOCKET_PORT}"
    print_status ""
    print_status "PM2 commands:"
    print_status "- View logs: pm2 logs"
    print_status "- Monitor: pm2 monit"
    print_status "- Restart: pm2 restart all"
    print_status "- Stop: pm2 stop all"
}

# Run main function
main "$@"
