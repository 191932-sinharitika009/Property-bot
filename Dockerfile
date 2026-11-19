FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8000
# The web application uses Node built-ins only; scraper dependencies stay outside.
COPY --chown=node:node server.mjs ./
COPY --chown=node:node chat/ ./chat/
COPY --chown=node:node retrieval/search.mjs retrieval/question.mjs retrieval/references.mjs ./retrieval/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node data/curated/records.jsonl ./data/curated/records.jsonl
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
