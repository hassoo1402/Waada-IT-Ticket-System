<?php
use Glpi\Plugin\Hooks;

define('PLUGIN_SLACKQUEUE_VERSION', '1.0.0');

function plugin_init_slackqueue()
{
    global $PLUGIN_HOOKS;

    file_put_contents(
        '/var/glpi/logs/slackqueue-init.log',
        date('Y-m-d H:i:s') . " | plugin_init_slackqueue executed\n",
        FILE_APPEND
    );

    $PLUGIN_HOOKS['csrf_compliant']['slackqueue'] = true;

    if (Plugin::isPluginActive('slackqueue')) {
        $PLUGIN_HOOKS[Hooks::ITEM_ADD]['slackqueue'] = [
            ITILFollowup::class => 'plugin_slackqueue_followup_added'
        ];
    }
}

function plugin_version_slackqueue()
{
    return [
        'name'           => 'Slack Queue',
        'version'        => PLUGIN_SLACKQUEUE_VERSION,
        'author'         => 'Waada',
        'license'        => 'GPLv3+',
        'homepage'       => '',
        'requirements'   => [
            'glpi' => [
                'min' => '11.0.0',
                'max' => '11.0.99',
            ],
        ],
    ];
}

function plugin_slackqueue_check_prerequisites()
{
    return true;
}

function plugin_slackqueue_check_config($verbose = false)
{
    return true;
}