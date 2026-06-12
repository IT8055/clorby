import { installChatBridge } from './chat'
import { installOrbBridge } from './orb'
import { installSnipBridge } from './snip'

// One built preload, but each window still gets exactly its own bridge. The
// document URL is known at preload time, so branch on it and expose nothing
// the window does not need.
if (location.pathname.includes('/chat/')) {
  installChatBridge()
} else if (location.pathname.includes('/snip/')) {
  installSnipBridge()
} else {
  installOrbBridge()
}
