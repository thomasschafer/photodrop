import Foundation
import FirebaseCore
import FirebaseMessaging
import Capacitor

/// Handles Firebase initialization and FCM token management.
/// Lives in CapApp-SPM so it can import Firebase modules (which are SPM dependencies).
/// AppDelegate calls these methods without needing to import Firebase directly.
@objc public class FirebaseSetup: NSObject {

    private static var messagingDelegate: FcmDelegate?

    /// Initialize Firebase and set up FCM messaging delegate.
    /// Call from AppDelegate.didFinishLaunchingWithOptions.
    @objc public static func configure(delegate: Any) {
        FirebaseApp.configure()
        messagingDelegate = FcmDelegate()
        Messaging.messaging().delegate = messagingDelegate
    }

    /// Forward APNs device token to Firebase for FCM token mapping.
    /// Call from AppDelegate.didRegisterForRemoteNotificationsWithDeviceToken.
    @objc public static func setApnsToken(_ deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
    }
}

/// Firebase Messaging delegate that forwards FCM tokens to Capacitor's push plugin.
class FcmDelegate: NSObject, MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let fcmToken = fcmToken else { return }
        print("FCM registration token: \(fcmToken.prefix(20))...")

        // Post the FCM token as a String. Capacitor's PushNotificationsPlugin
        // handles String objects on this notification (casts via `as? String`),
        // so the JS `registration` event receives the FCM token directly.
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: fcmToken
        )
    }
}
