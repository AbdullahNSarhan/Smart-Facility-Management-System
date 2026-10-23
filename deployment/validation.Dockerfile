# The installer and updater execute the complete integration suite inside this image.
# Unlike the vanilla node:24-alpine image, the suite needs git, bash and flock
# to exercise deployment rollback, locking and Git worktree operations.
FROM node:24-alpine

RUN apk add --no-cache bash git flock \
    && command -v git \
    && command -v bash \
    && command -v flock

WORKDIR /workspace
