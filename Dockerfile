# Debian slim, NOT alpine.
#
# Puppeteer ships a Chrome-for-Testing binary linked against glibc. Alpine uses
# musl, so that binary cannot execute at all — every server-side render (receipt
# PDFs today, coupon design exports now) fails at runtime while the build looks
# perfectly healthy. Switching the base is the fix; there is no Alpine variant
# of that binary.
FROM node:20-bookworm-slim

# Chromium plus the font packages it needs. Fonts matter as much as the
# binary: without them Chrome silently substitutes a fallback face, so
# exports look correct to the code and wrong to the customer — worst for ₹
# and Devanagari, both of which this product renders on receipts and coupons.
#   fonts-liberation       — Arial/Helvetica/Times metric substitutes
#   fonts-noto-core        — broad Unicode coverage
#   fonts-noto-color-emoji — emoji used in marketing artwork
#   fonts-indic            — Devanagari and other Indic scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-color-emoji \
      fonts-indic \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Use the apt-installed Chromium rather than downloading a second copy at
# install time — saves ~170MB in the image and one moving part.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./

# Install ALL dependencies including devDependencies (needed for esbuild)
RUN npm install

COPY . .

# Build TypeScript with esbuild
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/index.js"]
