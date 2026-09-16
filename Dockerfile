FROM node:18 AS process-dev

# Install pnpm and pm2
RUN npm install -g pnpm pm2

# Set the working directory
WORKDIR /app

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN chmod +x /usr/local/bin/docker-entrypoint

ENTRYPOINT [ "docker-entrypoint" ]
CMD [ "pm2-dev", "ecosystem.config.js" ]

FROM process-dev AS process

COPY . .

RUN pnpm install

CMD [ "pm2-runtime", "--json", "ecosystem.config.js" ]
