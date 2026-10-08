<?php

function plugin_slackqueue_install()
{
    return true;
}

function plugin_slackqueue_uninstall()
{
    return true;
}

function plugin_slackqueue_followup_added(ITILFollowup $followup)
{
    file_put_contents(
        '/var/glpi/logs/slackqueue.log',
        date('Y-m-d H:i:s') .
        " | ITILFollowup captured | ID: " .
        $followup->getID() .
        PHP_EOL,
        FILE_APPEND
    );
}