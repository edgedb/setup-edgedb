import * as main from './main'
import * as win from './win'
import * as os from 'os'

if (os.platform() === 'win32') {
  win.run()
} else {
  main.run()
}
