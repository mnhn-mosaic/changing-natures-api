module.exports = {
    apps: [{
        name: 'changing-natures-api',
        script: './index.js',
        autorestart: true, // Auto-restart app on crash
        watch: false,      // If true, will restart app on file changes
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'development'
        },
        env_production: {
            NODE_ENV: 'production'
        }
    }]
};