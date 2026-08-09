-- Native mobile apps (Capacitor + FCM) were removed in the previous release,
-- so nothing reads or writes native device tokens any more. The drop ships
-- separately from the code removal because deploys migrate before deploying
-- the Worker: dropping in the same release would have broken the still-live
-- old Worker, whose account-deletion batch referenced this table. By now
-- neither the deployed nor the deploying Worker references it. Web push
-- (push_subscriptions) is unaffected.
DROP TABLE device_tokens;
