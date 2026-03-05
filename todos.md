session are restarting 

we may need to add full integration with stripe and vercel

we need to improve schedule to be more proactive of feel very useful

connect with slack
connect with telegram

support for history sessions
summarize past sessions

is the agent really working autonomously?

you dont need a co-worker you need a co-founder

all the run commands or the most importat should render in the ui to avoid running commands in terminal

maybe add terminal later?


the tool should also build its own tools or artifacts that will help understand the current agent use case more easy, like dashboards, logs, anything ui related actually, the ui can be so dynamically like artifacts 

You are a solo founder and you need to grow this project to 10MRR, every 24hrs you check you progress adapt and improve, you can try or invent anything that helps you reach your goal, you can write tools, services, hacks anything, you are 1000x founder mode enabled


IMPORTANT
you can challengue all my assumptions here checking what will a group of experts in all these areas do to improve this



IMPORTANT
you can challengue all my assumptions here checking what will a group of experts in all these areas do to implement this


IMPORTANT
check with a group of experts in all these areas to implement this correctly

please check all the staged changes and see if the implementation cam be improve for performance, ux, code quality




Great that you already have signing creds from your other app! Here's the good news:

Yes, you can reuse the same credentials. Your Apple Developer certificate and provisioning profile work across multiple apps — they're tied to your developer account, not a specific app.

Here's what we need to do:

What you already have (from your other app):

Apple Developer account ($99/yr membership)
Developer ID Application certificate
Possibly a provisioning profile
What we need to set up for Co-Founder:

Create a new App ID in Apple Developer portal for com.agentfounder.app (each app needs its own App ID, but uses the same signing certificate)
Add signing config to Tauri — we need your:

Apple Developer Team ID (10-char alphanumeric, e.g. ABC1234DEF)
Signing identity name (usually Developer ID Application: Your Name (TEAMID))
Set up notarization — Apple requires notarization for distribution outside the App Store. We need:

Your Apple ID
An app-specific password (generate at appleid.apple.com → Security → App-Specific Passwords)
Can you check a couple things for me?

Run this in your terminal to see your existing signing identity:

security find-identity -v -p codesigning
This will show your Developer ID certificate. Share the output (or just the identity name + Team ID) and I'll configure the Tauri build to use it.

Also — do you remember if you set up notarization for your other app? If so, we can reuse the same Apple ID + app-specific password.