# The installer and updater execute the complete integration suite inside this image.
# Unlike the vanilla node:24-alpine image, the suite needs git, bash, flock and python3
# to exercise deployment rollback, locking and Git worktree operations.
FROM node:24-alpine

RUN apk add --no-cache bash git flock python3 \
    && command -v git \
    && command -v bash \
    && command -v flock \
    && command -v python3

WORKDIR /workspace
