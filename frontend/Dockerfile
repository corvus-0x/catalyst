# frontend/Dockerfile — Development environment with Vite HMR
# For production (Railway), the frontend is compiled into the Django
# image by the multi-stage Dockerfile at the repository root.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Source code is bind-mounted at runtime by docker-compose.
# The node_modules installed above are preserved by an anonymous
# volume in docker-compose.yml so the host directory cannot shadow them.
EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
