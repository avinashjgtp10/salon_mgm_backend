# Salon Management Backend

AI-Powered Salon Growth Platform - Backend API

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Redis 7+

### Installation

```bash
# Clone repository
git clone https://github.com/avinashjgtp10/salon_mgm_backend.git
cd salon_mgm_backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Update .env.local with your database credentials

# Create database
createdb salon_dev

# Start development server
npm run dev
```

Server will start at http://localhost:3000

## 📁 Project Structure

```
src/
├── config/         # Configuration files
├── modules/        # Feature modules
├── middleware/     # Express middleware
├── database/       # Migrations & seeds
├── utils/          # Utility functions
├── app.ts          # Express app
└── server.ts       # Entry point
```

## 🛠️ Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run migrate:up` - Run migrations

## 📝 API Documentation

### Health Check
```
GET /health
```

## 🔧 Environment Variables

See `.env.example` for all required environment variables.

## 📄 License

Proprietary - All rights reserved
