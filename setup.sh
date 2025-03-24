#!/bin/bash

# Update system packages
apt-get update
apt-get upgrade -y

# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install ffmpeg
apt-get install -y ffmpeg

# Install PM2 globally
npm install -g pm2

# Create a directory for the app
mkdir -p /var/www/recipe-backend
cd /var/www/recipe-backend

# Copy your application files here
# (You'll upload them in a later step)

# Install app dependencies
npm install

# Start the application with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup 