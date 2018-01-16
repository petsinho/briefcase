// TODO: Cleanup
// TODO: Option to delete photos after upload
import React, { Component } from 'react';
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

  getFileName = (imgURI, coords = null) => {
    const name = `${imgURI.substr(imgURI.lastIndexOf('/') + 1, imgURI.length)}`;
    return coords ?
      `${name}@${this.getLocation()}` :
      name;
  }

  upload = async (file) => {
    return new Promise(async (resolve, reject) => {
      const imgURI = file.node.image.uri;
      this.setState({ uploadingFile: imgURI });
      const fileToUpload = {
        uri: imgURI,
        name: this.getFileName(imgURI, file.node.coordinates),
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
          reject(response);
        }
        this.setState({
          filesUploaded: ++this.state.filesUploaded,
        });
        resolve();
      } catch (e) { reject(e); }
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
    this.setState({ isUploading: true });
    try {
      await Promise.all(photosToUpload.map(p => this.upload(p)));
    } catch (e) {
      console.log('something went wrong while uploading: ', e);
    } finally {
      console.log('All done! :)');
      this.setState({
        isUploading: false,
        selectedPhotos: [],
        filesUploaded: 0,
      });
    }
  }

  handleSelectPhotosClick = async () => {
    const fetchedPhotos = await this.getPhotos();
    this.setState({ selectedPhotos: fetchedPhotos });
  }

  handleUploadClick = async () => {
    // TODO: UI Feedback improvements
    this.uploadPhotos();
  }

  renderUploadProgress() {
    const { filesUploaded, selectedPhotos } = this.state;
    return this.state.isUploading &&
      <Text>
        Files uploaed: {filesUploaded} / {selectedPhotos.length}
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
      'Select photos';

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
        maximumValue={1000}
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
          disabled={!this.state.selectedPhotos.length}
        />
        {this.renderUploadProgress()}
        </View>
    );
  }
}
