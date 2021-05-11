import * as os from 'os'
import * as main from './main'
import * as win from './win'

if (os.platform() === 'win32') {
  win.run()
} else {
  main.run()
}
