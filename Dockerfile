# Use a lightweight base image
FROM debian:stable-slim

# Set working directory
WORKDIR /app

# Copy the server binary
COPY server-bin .

# Expose port (default 3000)
EXPOSE 3000

# Set executable permission (just in case)
RUN chmod +x server-bin

# Run the server
CMD ["./server-bin"]
