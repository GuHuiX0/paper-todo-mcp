using System;
using System.Threading;
using System.Windows;

namespace PaperTodoDesktop
{
    public static class Program
    {
        private const string MUTEX_NAME = @"Local\PaperTodoMcp_SingleInstance_v1";
        private const string WAKE_EVENT_NAME = @"Local\PaperTodoMcp_WakeEvent_v1";

        [STAThread]
        public static void Main(string[] args)
        {
            NativeInterop.EnablePerMonitorDpiV2();

            int port = 4789;
            string envPort = Environment.GetEnvironmentVariable("PAPER_TODO_PORT");
            int parsedEnvPort;
            if (!string.IsNullOrEmpty(envPort) && int.TryParse(envPort, out parsedEnvPort) && parsedEnvPort > 0)
            {
                port = parsedEnvPort;
            }

            string dataDir = Environment.GetEnvironmentVariable("PAPER_TODO_DATA_DIR");
            string serverScript = null;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--port" && i + 1 < args.Length)
                {
                    int p;
                    if (int.TryParse(args[++i], out p) && p > 0) port = p;
                }
                else if (a.StartsWith("--port="))
                {
                    int p;
                    if (int.TryParse(a.Substring("--port=".Length), out p) && p > 0) port = p;
                }
                else if ((a == "--data-dir" || a == "--data_dir") && i + 1 < args.Length)
                {
                    dataDir = args[++i];
                }
                else if (a.StartsWith("--data-dir="))
                {
                    dataDir = a.Substring("--data-dir=".Length);
                }
                else if (a == "--server" && i + 1 < args.Length)
                {
                    serverScript = args[++i];
                }
                else if (a.StartsWith("--server="))
                {
                    serverScript = a.Substring("--server=".Length);
                }
            }

            bool createdNew;
            using (Mutex singleInstanceMutex = new Mutex(true, MUTEX_NAME, out createdNew))
            {
                if (!createdNew)
                {
                    // Another instance is already running: signal it to restore and focus
                    try
                    {
                        EventWaitHandle existingWake = EventWaitHandle.OpenExisting(WAKE_EVENT_NAME);
                        existingWake.Set();
                        existingWake.Dispose();
                    }
                    catch
                    {
                        // Ignore if opening wake handle raced
                    }
                    return;
                }

                EventWaitHandle wakeEvent = new EventWaitHandle(false, EventResetMode.AutoReset, WAKE_EVENT_NAME);
                Application app = new Application();
                app.ShutdownMode = ShutdownMode.OnExplicitShutdown;

                PaperWindow window = new PaperWindow(port, dataDir, serverScript);

                Thread wakeThread = new Thread(delegate()
                {
                    while (true)
                    {
                        try
                        {
                            wakeEvent.WaitOne();
                            if (app.Dispatcher.HasShutdownStarted || app.Dispatcher.HasShutdownFinished)
                            {
                                break;
                            }
                            app.Dispatcher.BeginInvoke(new Action(delegate()
                            {
                                window.SummonFromExternal();
                            }));
                        }
                        catch
                        {
                            break;
                        }
                    }
                });
                wakeThread.IsBackground = true;
                wakeThread.Start();

                window.Show();
                app.Run(window);

                try { wakeEvent.Dispose(); } catch { }
            }
        }
    }
}
