-- Native mobile apps (Capacitor + FCM) have been removed, so nothing writes
-- or reads native device tokens any more. Web push (push_subscriptions) is
-- unaffected.
DROP TABLE device_tokens;
