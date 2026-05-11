FROM oven/bun:1-slim
WORKDIR /app

# System deps + AWS CLI v2. AWS CLI lives in the image so the user doesn't
# need it on the host; `docker compose run --rm ms-teams-agentic-muppet aws
# configure sso` is the supported first-time auth flow.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    ca-certificates \
    curl \
    unzip \
 && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip \
 && unzip -q /tmp/awscliv2.zip -d /tmp \
 && /tmp/aws/install \
 && rm -rf /tmp/aws /tmp/awscliv2.zip \
 && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./

EXPOSE 3978
CMD ["bun", "src/index.ts"]
