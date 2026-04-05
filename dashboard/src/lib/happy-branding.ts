/**
 * Shared “Happy” ops agent identity — used by the chat UI and Discord webhooks
 * (watchdog, etc.) so notifications match the same name and avatar.
 *
 * Override per deploy with WATCHDOG_DISCORD_USERNAME / WATCHDOG_DISCORD_AVATAR_URL
 * (or HAPPY_AGENT_* ) if you host the avatar elsewhere.
 */
export const HAPPY_AGENT_NAME = "Happy";

/** Must be HTTPS and publicly reachable — Discord fetches this URL for webhook avatars. */
export const HAPPY_AGENT_AVATAR_URL =
  "https://scontent-yyz1-1.xx.fbcdn.net/v/t39.30808-1/309431358_839585507201666_5985498661297484474_n.jpg?stp=dst-jpg_s200x200_tt6&_nc_cat=108&ccb=1-7&_nc_sid=2d3e12&_nc_ohc=KFjupLz53d4Q7kNvwFbX2BC&_nc_oc=AdoaeOOiDneeCg_USvKqpjpNxM5PNb9H122XsKrB3IJBjqw6DL9FYOQofTuBt7cYl4A&_nc_zt=24&_nc_ht=scontent-yyz1-1.xx&_nc_gid=SgAVuAma207_wNxbkFIvug&_nc_ss=7a3a8&oh=00_Af3p3gPSNBSYzggOstJkRUDatjpjl2dKqPiWxl-GsG6YfA&oe=69D83B42";
