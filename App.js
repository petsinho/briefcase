// TODO: Cleanup
// TODO: Option to delete photos after upload
import React, { Component } from 'react';
import sleep from 'sleep-promise';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  CameraRoll,
  Button,
  ToolbarAndroid,
  Slider,
} from 'react-native';
import moment from 'moment';
import { RNS3 } from 'react-native-aws3';


import AwsOptions from './secrets';


// TODO: import styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 40,
    textAlign: 'center',
    margin: 10,
  },
  welcomeLarge: {
    fontSize: 80,
    textAlign: 'center',
    margin: 15,
  },
  instructions: {
    textAlign: 'center',
    color: '#333333',
    marginBottom: 5,
  },
  basicButton: {
    textAlign: 'center',
  },
});

// const AwsOptions = {
//   keyPrefix: 'uploads/petsbox/',
//   bucket: '*****',
//   region: '******',
//   accessKey: '*************',
//   secretKey: '********************',
//   successActionStatus: 201,
// };

// TODO: Add config menu
export default class App extends Component {

  // TODO: Make limit configurable
  state = {
    selectedPhotos: [],
    isUploading: false,
    fileLimit: 5,
    filesUploaded: 0,
    filesSkipped: [],
    showProgress: false,
  }

  getPhotos = () => {
    return new Promise((resolve, reject) => {
      CameraRoll.getPhotos({
        first: this.state.fileLimit,
        assetType: 'All',
      })
      .then(r => {
        resolve(r.edges);
      })
      .catch(e => reject(e));
    });
  }

  fileSkipped = (file) => {
    console.warn('file skipped: ', file);
    this.setState({
      filesSkipped: this.state.filesSkipped.concat(file),
    });
  }

  toggleModal = () => {
    this.setState({ modalVisible: !this.state.modalVisible });
  }

  // TODO: use https://github.com/devfd/react-native-geocoder
  // to tag the location
  getLocation = () => {
    return 'mordor';
    // return new Promise((resolve, reject) => {
    //   geocoder.reverseGeocode(33.7489, -84.3789, (err, data) => {
    //   // do something with data
    //     console.log('resolved loc: ', data);
    //     if (err) reject(err);
    //     resolve(data);
    //   });
    // });
  };

  getFileName = (file) => {
    const { uri } = file.node.image;
    const { type, coordinates } = file.node;
    const name = `${uri.substr(uri.lastIndexOf('/') + 1, uri.length)}`;
    const fileName = coordinates ?
      `${name}@${this.getLocation()}` :
      name;
    const suffix = type.split('/')[1];
    return `${fileName}.${suffix}`;
  }

  upload = async (file) => {
    return new Promise(async (resolve) => {
      const imgURI = file.node.image.uri;
      const fileToUpload = {
        uri: imgURI,
        name: this.getFileName(file),
        type: file.node.type,
      };
      try {
        const folderPrefix = file.folder;
        const prefixedAwsOptions = {
          ...AwsOptions,
          keyPrefix: AwsOptions.keyPrefix + folderPrefix,
        };
        const response = await RNS3.put(fileToUpload, prefixedAwsOptions);
        if (response.status !== 201) {
          this.fileSkipped({ file, error: response });
          resolve();
        }
        this.setState({
          filesUploaded: ++this.state.filesUploaded,
        });
        resolve();
      } catch (e) {
        this.fileSkipped({ file, error: e });
      } finally {
        resolve();
      }
    });
  }

  getPrefixFolderByDate = (date) => {
    const year = moment.unix(date).format('YYYY');
    const month = moment.unix(date).format('MMMM');
    return `${year}/${month}/`;
  }

  organizeFiles = (files) => {
    const result = files.map(file => {
      const date = file.node.timestamp;
      const prefix = this.getPrefixFolderByDate(date);
      return {
        ...file,
        folder: prefix,
      };
    });
    return result;
  }

  uploadPhotos = async () => {
    const photosToUpload = this.organizeFiles(this.state.selectedPhotos);
    await Promise.all(photosToUpload.map(p => this.upload(p)));

    console.log('All done! :)');
    if (this.state.filesSkipped.length) {
      console.log('Files skipped with errors: ', this.state.filesSkipped);
    }
    this.setState({
      isUploading: false,
      selectedPhotos: [],
      filesUploaded: 0,
    });
  }

  handleSelectPhotosClick = async () => {
    const fetchedPhotos = await this.getPhotos();
    this.setState({
      selectedPhotos: fetchedPhotos,
      showProgress: true,
    });
  }

  handleUploadClick = async () => {
    // TODO: UI Feedback improvements
    this.setState({ isUploading: true });
    await sleep(50);
    this.uploadPhotos();
  }

  renderUploadProgress() {
    const { filesUploaded, selectedPhotos } = this.state;
    const progressText = filesUploaded ?
      `Files uploaded: ${filesUploaded} / ${selectedPhotos.length}` :
      'Preparing files for upload';
    return this.state.showProgress &&
      <Text>
      {progressText}
      </Text>;
  }
  photosNumberChange = (value) => {
    this.setState({
      fileLimit: value,
    });
  }
  render() {
    const selectText = this.state.selectedPhotos.length ?
      `${this.state.selectedPhotos.length} photos selected` :
      'Select files';

    return (
      <View style={styles.container}>
        <Text style={styles.welcomeLarge}>
          📦
        </Text>
        <Text style={styles.welcome}>
          Welcome to Petsbox!
        </Text>
        <Text style={{ margin: 20 }}>
          Select number of files to upload : {this.state.fileLimit}
        </Text>
        <Slider
        maximumValue={2000}
        minimumValue={1}
        step={10}
        onValueChange={this.photosNumberChange}
        onSlidingComplete={this.photosNumberChange}
        style={{ width: 300, height: 50, marginBottom: 60 }}
        />
        <Button
          title={selectText}
          buttonStyle={styles.basicButton}
          onPress={this.handleSelectPhotosClick}
        />
        <Button
          buttonStyle={styles.basicButton}
          color="#841584"
          title="Upload to ☁️"
          onPress={this.handleUploadClick}
          disabled={this.state.isUploading}
        />
        {this.renderUploadProgress()}
        </View>
    );
  }
}
