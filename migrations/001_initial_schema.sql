CREATE DATABASE IF NOT EXISTS slack_integration;

USE slack_integration;

CREATE TABLE IF NOT EXISTS handlers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    glpi_user_id INT NOT NULL UNIQUE,
    handler_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS round_robin_state (
    category VARCHAR(50) PRIMARY KEY,
    last_handler_id INT NULL,
    FOREIGN KEY (last_handler_id) REFERENCES handlers(id)
);


CREATE TABLE IF NOT EXISTS ticket_mappings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    glpi_ticket_id INT NOT NULL UNIQUE,
    slack_channel_id VARCHAR(50) NOT NULL,
    slack_message_ts VARCHAR(50) NOT NULL,
    slack_thread_ts VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);