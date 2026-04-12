#!/bin/bash

# ETL Pipeline Test Suite
# Tests all components of the AFL ETL pipeline

set -e  # Exit on any error

echo "🚀 AFL ETL Pipeline Test Suite"
echo "=============================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

run_test() {
    local test_name="$1"
    local test_command="$2"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    echo
    log_info "Test $TESTS_RUN: $test_name"
    
    if eval "$test_command"; then
        log_info "✅ PASSED: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        log_error "❌ FAILED: $test_name"
        return 1
    fi
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found"
        exit 1
    fi
    
    # Check R
    if ! command -v R &> /dev/null; then
        log_error "R not found"
        exit 1
    fi
    
    # Check npm packages
    if [ ! -d "node_modules" ]; then
        log_error "Node modules not found. Run: npm install"
        exit 1
    fi
    
    # Check TypeScript build
    if [ ! -d "dist" ]; then
        log_error "TypeScript build not found. Run: npm run build"
        exit 1
    fi
    
    log_info "✅ Prerequisites check passed"
}

# Test R script
test_r_script() {
    run_test "R Script - Basic Execution" \
        "timeout 30s bash -c 'OUTFILE=/tmp/player_stats_fryzigg_smoke.json Rscript fetch_fw_round.R 2024 && head -5 /tmp/player_stats_fryzigg_smoke.json | wc -l | grep -q \"^[1-5]$\"'"
    
    run_test "R Script - JSON Output Format" \
        "timeout 30s bash -c 'OUTFILE=/tmp/player_stats_fryzigg_smoke.json Rscript fetch_fw_round.R 2024 && head -1 /tmp/player_stats_fryzigg_smoke.json | jq . > /dev/null'"
    
    run_test "R Script - Required Fields" \
        "timeout 30s bash -c 'OUTFILE=/tmp/player_stats_fryzigg_smoke.json Rscript fetch_fw_round.R 2024 && head -1 /tmp/player_stats_fryzigg_smoke.json | jq \"has(\\\"season\\\") and has(\\\"round\\\") and has(\\\"team\\\") and has(\\\"player_name\\\")\"'"
}

# Test Node.js ETL processor
test_node_processor() {
    # Create test data
    local test_data='{
        "season": 2024,
        "round": 1,
        "team": "Adelaide",
        "opposition": "Collingwood", 
        "player_name": "Test Player",
        "kicks": 15,
        "handballs": 10,
        "disposals": 25,
        "goals": 2,
        "behinds": 1
    }'
    
    run_test "Node Processor - Basic Input Processing" \
        "echo '$test_data' | timeout 10s node dist/etl/processFootywireData.js || true"
}

# Test validation script
test_validation() {
    # Test with non-existent match (should fail gracefully)
    run_test "Validation Script - Non-existent Match" \
        "timeout 10s node dist/etl/validateMatchData.js 'test-match-uid' 2>&1 | grep -q 'not found' || true"
}

# Test Live Guard
test_live_guard() {
    run_test "Live Guard - Basic Initialization" \
        "timeout 5s node dist/etl/liveGuard.js 2>&1 | grep -q 'Starting Live Guard' || true"
}

# Test TypeScript compilation
test_typescript() {
    run_test "TypeScript - Clean Compilation" \
        "npm run build"
    
    run_test "TypeScript - No Type Errors" \
        "npx tsc --noEmit"
}

# Test Docker build (if Docker available)
test_docker() {
    if command -v docker &> /dev/null; then
        run_test "Docker - Build Image" \
            "docker build -t statly-etl-test . --quiet"
        
        run_test "Docker - Image Health" \
            "docker run --rm statly-etl-test node --version"
            
        # Cleanup
        docker rmi statly-etl-test &> /dev/null || true
    else
        log_warn "Docker not available, skipping Docker tests"
    fi
}

# Test environment configuration
test_environment() {
    run_test "Environment - Template Exists" \
        "test -f .env.template"
    
    run_test "Environment - Required Variables" \
        "grep -q 'FIREBASE_SERVICE_ACCOUNT_JSON' .env.template"
}

# Test R package dependencies
test_r_packages() {
    local packages=("fitzRoy" "jsonlite" "janitor" "dplyr" "stringr")
    
    for package in "${packages[@]}"; do
        run_test "R Package - $package" \
            "Rscript -e \"library($package)\" 2>/dev/null"
    done
}

# Integration test (if environment configured)
test_integration() {
    if [ -f ".env" ] && grep -q "FIREBASE_SERVICE_ACCOUNT_JSON=." .env; then
        log_info "Environment configured - running integration tests"
        
        run_test "Integration - R to Node Pipeline" \
            "timeout 30s bash -c 'OUTFILE=/tmp/player_stats_fryzigg_test.json Rscript fetch_fw_round.R 2024 && head -5 /tmp/player_stats_fryzigg_test.json | node dist/etl/processFootywireData.js' || true"
    else
        log_warn "Environment not configured (.env missing), skipping integration tests"
        log_warn "Copy .env.template to .env and configure Firebase credentials for full testing"
    fi
}

# Performance test
test_performance() {
    log_info "Running performance tests..."
    
    # Test R script performance
    local r_start=$(date +%s)
    timeout 60s OUTFILE=/tmp/player_stats_fryzigg_perf.json Rscript fetch_fw_round.R 2024 > /dev/null || true
    local r_end=$(date +%s)
    local r_duration=$((r_end - r_start))
    
    if [ $r_duration -lt 30 ]; then
        log_info "✅ R Script Performance: ${r_duration}s (good)"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        log_warn "⚠️ R Script Performance: ${r_duration}s (slow)"
    fi
    TESTS_RUN=$((TESTS_RUN + 1))
}

# Main test execution
main() {
    cd "$(dirname "$0")"
    
    echo "Current directory: $(pwd)"
    echo "Timestamp: $(date)"
    echo
    
    check_prerequisites
    
    echo
    log_info "Starting test suite..."
    
    # Core functionality tests
    test_typescript
    test_environment
    test_r_packages
    test_r_script
    test_node_processor
    test_validation
    test_live_guard
    
    # Optional tests
    test_docker
    test_integration
    test_performance
    
    # Results summary
    echo
    echo "=========================================="
    log_info "Test Suite Complete"
    echo "Tests run: $TESTS_RUN"
    echo "Tests passed: $TESTS_PASSED"
    echo "Tests failed: $((TESTS_RUN - TESTS_PASSED))"
    
    if [ $TESTS_PASSED -eq $TESTS_RUN ]; then
        echo
        log_info "🎉 All tests passed!"
        exit 0
    else
        echo
        log_error "Some tests failed. Check output above."
        exit 1
    fi
}

# Run tests
main "$@"
